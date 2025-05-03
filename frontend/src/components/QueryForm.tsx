import {
  FormEvent,
  useState,
  useEffect,
  useRef,
  KeyboardEvent,
  useCallback,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './QueryForm.module.scss';

type QueryResponse = {
  status: string;
  data: string;
};

type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
};

export default function QueryForm() {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are a helpful assistant.' },
  ]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const responsesContainerRef = useRef<HTMLDivElement | null>(null);

  // textarea 높이 자동 조절
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 168)}px`;
    }
  };

  // 스크롤을 최하단으로 이동
  const scrollToBottom = useCallback(() => {
    if (isAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isAutoScroll]);

  // 스크롤 이벤트 핸들러
  const handleScroll = () => {
    if (responsesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } =
        responsesContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;

      setIsAutoScroll(isAtBottom);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-focus the textarea when the component mounts
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Re-focus the textarea after submitting a message
  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      // Only submit if not loading
      if (!isLoading && prompt.trim()) {
        handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
      }
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isLoading) return;

    if (!prompt.trim()) return;

    const userMessage = prompt.trim();

    // Add user message to the conversation
    const updatedMessages = [
      ...messages,
      { role: 'user' as const, content: userMessage },
    ];
    setMessages(updatedMessages);

    // Add placeholder for assistant response
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isStreaming: true },
    ]);

    setPrompt('');
    setIsLoading(true);
    setIsAutoScroll(true);

    try {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Create a StreamingTextEncoder to handle SSE
      const chatController = new AbortController();
      const signal = chatController.signal;

      // Make a POST request with the conversation history
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          messages: updatedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
        signal: signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const readStream = async () => {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            setIsLoading(false);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.isStreaming) {
                lastMessage.isStreaming = false;
              }
              return newMessages;
            });
            break;
          }

          // Decode the chunk and add it to our buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the last incomplete chunk in the buffer

          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const jsonStr = line.slice(5).trim(); // Remove 'data:' prefix
                const parsedData = JSON.parse(jsonStr) as QueryResponse;

                if (parsedData.data === 'Stream finished') {
                  setIsLoading(false);
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.isStreaming) {
                      lastMessage.isStreaming = false;
                    }
                    return newMessages;
                  });
                } else {
                  const formattedData = parsedData.data;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.isStreaming) {
                      lastMessage.content += formattedData;
                    }
                    return newMessages;
                  });
                }
              } catch (e) {
                // Parse error handling
                console.error('Error parsing SSE data:', e);
              }
            }
          }
        }
      };

      readStream().catch((error) => {
        console.error('Stream reading error:', error);
        setIsLoading(false);
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.isStreaming) {
            lastMessage.isStreaming = false;
            lastMessage.content += '\n[Error: Connection failed]';
          }
          return newMessages;
        });
      });

      // Store the controller to allow stopping the stream
      eventSourceRef.current = {
        close: () => {
          chatController.abort();
        },
      } as unknown as EventSource;
    } catch (error) {
      console.error('Failed to start chat:', error);
      setIsLoading(false);
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && lastMessage.isStreaming) {
          lastMessage.isStreaming = false;
          lastMessage.content += '\n[Error: Connection failed]';
        }
        return newMessages;
      });
    }
  };

  const handleStop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsLoading(false);

      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && lastMessage.isStreaming) {
          lastMessage.content += '\n[생성 중단됨]';
          lastMessage.isStreaming = false;
        }
        return newMessages;
      });
    }
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  const getVisibleMessages = () => {
    // Filter out system messages from display
    return messages.filter((msg) => msg.role !== 'system');
  };

  return (
    <div className={styles.queryFormContainer}>
      <div
        className={styles.responsesContainer}
        ref={responsesContainerRef}
        onScroll={handleScroll}
      >
        {getVisibleMessages().map((message, index) => (
          <div
            key={index}
            className={`${styles.messageWrapper} ${
              message.role === 'user'
                ? styles.userMessage
                : styles.assistantMessage
            }`}
          >
            <div className={styles.messageContent}>
              {message.role === 'assistant' ? (
                <>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isInline =
                          !match &&
                          node?.tagName === 'code' &&
                          !node?.position?.start?.line;

                        return !isInline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span className={styles.cursor}>▋</span>
                  )}
                </>
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputSection}>
        <form onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your prompt here... (Press Enter to submit, Shift+Enter for new line)"
              className={styles.textarea}
              rows={1}
              // Removed the disabled attribute to allow cursor placement anytime
            />
            <button
              type={isLoading ? 'button' : 'submit'}
              onClick={isLoading ? handleStop : undefined}
              disabled={isLoading ? false : !prompt.trim()}
              className={`${styles.button} ${isLoading ? styles.stopButton : ''}`}
            >
              {isLoading ? 'Stop' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
