import {
  FormEvent,
  useState,
  useEffect,
  useRef,
  KeyboardEvent,
  useCallback,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './QueryForm.module.scss';

type QueryResponse = {
  status: string;
  data: string;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

export default function QueryForm() {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isLoading) {
      event.preventDefault();
      handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isLoading) return;

    if (!prompt.trim()) return;

    const userMessage = prompt.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isStreaming: true },
    ]);

    setPrompt('');
    setIsLoading(true);
    setIsAutoScroll(true);

    try {
      eventSourceRef.current = new EventSource(
        `http://localhost:8000/ask_query?prompt=${encodeURIComponent(userMessage)}`,
      );

      eventSourceRef.current.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data) as QueryResponse;

          if (parsedData.data === 'Stream finished') {
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
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
        } catch {
          // 파싱 에러 로그 제거
        }
      };

      eventSourceRef.current.onerror = () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsLoading(false);

        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.isStreaming) {
            lastMessage.isStreaming = false;
          }
          return newMessages;
        });
      };
    } catch {
      setIsLoading(false);
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

  return (
    <div className={styles.queryFormContainer}>
      <div
        className={styles.responsesContainer}
        ref={responsesContainerRef}
        onScroll={handleScroll}
      >
        {messages.map((message, index) => (
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
              disabled={isLoading}
              className={styles.textarea}
              rows={1}
            />
            <button
              type={isLoading ? 'button' : 'submit'}
              onClick={isLoading ? handleStop : undefined}
              disabled={!isLoading && !prompt.trim()}
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
