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

type ChatHistory = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
};

export default function QueryForm() {
  const [prompt, setPrompt] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are a helpful assistant.' },
  ]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [needsTitle, setNeedsTitle] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState<string>('');

  const eventSourceRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const responsesContainerRef = useRef<HTMLDivElement | null>(null);

  // Load chat history from localStorage
  const loadChatHistory = useCallback(() => {
    try {
      const savedChats = localStorage.getItem('chatHistory');
      if (savedChats) {
        const parsed = JSON.parse(savedChats);
        // Sort by most recent first
        const sorted = parsed.sort(
          (a: ChatHistory, b: ChatHistory) => b.createdAt - a.createdAt,
        );
        setChatHistory(sorted);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  }, []);

  // Load the current chat or create a new one on mount
  useEffect(() => {
    const loadInitialChat = () => {
      try {
        const savedChats = localStorage.getItem('chatHistory');
        if (savedChats) {
          const chats: ChatHistory[] = JSON.parse(savedChats);
          if (chats.length > 0) {
            // Load the most recent chat
            const mostRecentChat = chats.sort(
              (a, b) => b.createdAt - a.createdAt,
            )[0];
            setMessages(mostRecentChat.messages);
            setCurrentChatId(mostRecentChat.id);
            return;
          }
        }

        // If no chats exist, create a new one
        createNewChat();
      } catch (error) {
        console.error('Failed to load chat history:', error);
        createNewChat();
      }
    };

    loadInitialChat();
    loadChatHistory();

    // Add event listener to update when chat history changes
    window.addEventListener('storageChange', loadChatHistory);

    return () => {
      window.removeEventListener('storageChange', loadChatHistory);
    };
  }, [loadChatHistory]);

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

  // 스크롤 이벤트
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

  // Handle title edit key events
  const handleTitleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    chatId: string,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditedTitle(chatId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTitle();
    }
  };

  // Start editing a chat title
  const startEditingTitle = (
    e: React.MouseEvent,
    chatId: string,
    currentTitle: string,
  ) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditedTitle(currentTitle);
  };

  // Save the edited title
  const saveEditedTitle = (chatId: string) => {
    if (!editedTitle.trim()) return;

    try {
      let currentHistory: ChatHistory[] = [];
      const saved = localStorage.getItem('chatHistory');
      if (saved) {
        currentHistory = JSON.parse(saved);
      }

      const chatIndex = currentHistory.findIndex((chat) => chat.id === chatId);
      if (chatIndex !== -1) {
        currentHistory[chatIndex].title = editedTitle.trim();
        localStorage.setItem('chatHistory', JSON.stringify(currentHistory));

        // Update the local state
        setChatHistory(currentHistory);

        // If editing the current chat, update its title
        if (chatId === currentChatId) {
          saveCurrentChat(messages, editedTitle.trim());
        }

        // Notify of storage change
        window.dispatchEvent(new Event('storageChange'));
      }
    } catch (error) {
      console.error('Failed to save edited title:', error);
    }

    // Reset the editing state
    setEditingChatId(null);
  };

  // Cancel editing title
  const cancelEditingTitle = () => {
    setEditingChatId(null);
  };

  // Format date for display in sidebar
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();

    // Same day
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    // Within a week
    const daysDiff = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysDiff < 7) {
      return (
        date.toLocaleDateString([], { weekday: 'short' }) +
        ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    }

    // Older
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: now.getFullYear() !== date.getFullYear() ? 'numeric' : undefined,
    });
  };

  // Create a new chat
  const createNewChat = () => {
    const newChatId = Date.now().toString();
    const newChat: ChatHistory = {
      id: newChatId,
      title: 'New Chat',
      messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
      createdAt: Date.now(),
    };

    // Update localStorage
    let currentHistory: ChatHistory[] = [];
    try {
      const saved = localStorage.getItem('chatHistory');
      if (saved) {
        currentHistory = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error parsing chat history:', error);
    }

    const updatedHistory = [newChat, ...currentHistory];
    localStorage.setItem('chatHistory', JSON.stringify(updatedHistory));

    // Update state
    setMessages(newChat.messages);
    setCurrentChatId(newChatId);
    setPrompt('');

    // Notify of storage change
    window.dispatchEvent(new Event('storageChange'));

    // Close sidebar on mobile after creating new chat
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  // Delete a chat
  const deleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();

    // Update localStorage
    let currentHistory: ChatHistory[] = [];
    try {
      const saved = localStorage.getItem('chatHistory');
      if (saved) {
        currentHistory = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error parsing chat history:', error);
    }

    const updatedHistory = currentHistory.filter((chat) => chat.id !== chatId);
    localStorage.setItem('chatHistory', JSON.stringify(updatedHistory));

    // Update state
    setChatHistory(updatedHistory);

    // If we're deleting the current chat, select a new one or create new
    if (chatId === currentChatId) {
      if (updatedHistory.length > 0) {
        selectChat(updatedHistory[0]);
      } else {
        createNewChat();
      }
    }

    // Notify of storage change
    window.dispatchEvent(new Event('storageChange'));
  };

  // Select a chat from history
  const selectChat = (chat: ChatHistory) => {
    setMessages(chat.messages);
    setCurrentChatId(chat.id);

    // Close sidebar on mobile after selecting
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  // Save the current chat to localStorage
  const saveCurrentChat = useCallback(
    (msgs: Message[], title?: string) => {
      if (!currentChatId) return;

      try {
        let currentHistory: ChatHistory[] = [];
        const saved = localStorage.getItem('chatHistory');
        if (saved) {
          currentHistory = JSON.parse(saved);
        }

        const currentChatIndex = currentHistory.findIndex(
          (chat) => chat.id === currentChatId,
        );

        if (currentChatIndex !== -1) {
          // Update existing chat
          currentHistory[currentChatIndex].messages = msgs;
          if (title) {
            currentHistory[currentChatIndex].title = title;
          }
        } else {
          // Create new chat entry if it doesn't exist
          currentHistory.unshift({
            id: currentChatId,
            title: title || 'New Chat',
            messages: msgs,
            createdAt: Date.now(),
          });
        }

        localStorage.setItem('chatHistory', JSON.stringify(currentHistory));

        // Notify of storage change
        window.dispatchEvent(new Event('storageChange'));
      } catch (error) {
        console.error('Failed to save chat history:', error);
      }
    },
    [currentChatId],
  );

  // Generate a title for the chat using the AI
  const generateChatTitle = useCallback(
    async (userMsg: string, aiResponse: string) => {
      try {
        const response = await fetch('http://localhost:8000/generate-title', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userMessage: userMsg,
            aiResponse: aiResponse,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.title) {
          saveCurrentChat(messages, data.title);
        }
      } catch (error) {
        console.error('Failed to generate title:', error);
        // Fallback to using the user message as title
        const fallbackTitle =
          userMsg.length > 30 ? `${userMsg.substring(0, 30)}...` : userMsg;
        saveCurrentChat(messages, fallbackTitle);
      }

      setNeedsTitle(false);
    },
    [messages, saveCurrentChat],
  );

  // Check if we need to generate a title
  useEffect(() => {
    if (needsTitle && messages.length >= 3 && !isLoading) {
      // Find the first user and assistant messages
      const userMsg =
        messages.find((msg) => msg.role === 'user')?.content || '';
      const aiMsg =
        messages.find((msg) => msg.role === 'assistant')?.content || '';

      if (userMsg && aiMsg) {
        generateChatTitle(userMsg, aiMsg);
      }
    }
  }, [needsTitle, messages, isLoading, generateChatTitle]);

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

    // If this is a new chat with only system message, we'll need to generate a title
    if (messages.length === 1 && messages[0].role === 'system') {
      setNeedsTitle(true);
    }

    // Save the current state of the chat
    saveCurrentChat(updatedMessages);

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

              // Save the completed chat
              saveCurrentChat(newMessages);
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

                    // Save the completed chat
                    saveCurrentChat(newMessages);
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

          // Save the chat with error
          saveCurrentChat(newMessages);
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

        // Save the chat with error
        saveCurrentChat(newMessages);
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

        // Save the chat with the stopped generation
        saveCurrentChat(newMessages);
        return newMessages;
      });
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
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
    <div
      className={`${styles.queryFormContainer} ${isSidebarOpen ? styles.sidebarOpen : ''}`}
    >
      {/* Sidebar Toggle Button */}
      <button
        className={styles.toggleButton}
        onClick={toggleSidebar}
        aria-label="Toggle Sidebar"
      >
        ☰
      </button>

      {/* Overlay for mobile - closes sidebar when clicked */}
      <div
        className={`${styles.overlay} ${isSidebarOpen ? styles.visible : ''}`}
        onClick={toggleSidebar}
      />

      {/* Sidebar */}
      <div className={`${styles.sidebar} ${isSidebarOpen ? styles.open : ''}`}>
        <div className={styles.sidebarHeader}>
          <h2>Chat History</h2>
          <button
            className={styles.closeButton}
            onClick={toggleSidebar}
            aria-label="Close sidebar"
          >
            ×
          </button>
        </div>

        <button className={styles.newChatButton} onClick={createNewChat}>
          + New Chat
        </button>

        <div className={styles.chatList}>
          {chatHistory.map((chat) => (
            <div
              key={chat.id}
              className={`${styles.chatItem} ${
                currentChatId === chat.id ? styles.active : ''
              }`}
              onClick={() => selectChat(chat)}
            >
              {editingChatId === chat.id ? (
                <div
                  className={styles.titleEditContainer}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    className={styles.titleEditInput}
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={(e) => handleTitleKeyDown(e, chat.id)}
                    autoFocus
                  />
                  <div className={styles.titleEditButtons}>
                    <button
                      className={styles.titleEditSaveButton}
                      onClick={() => saveEditedTitle(chat.id)}
                      aria-label="Save title"
                    >
                      ✓
                    </button>
                    <button
                      className={styles.titleEditCancelButton}
                      onClick={cancelEditingTitle}
                      aria-label="Cancel editing"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={styles.chatTitle}>{chat.title}</span>
                  <span className={styles.chatDate}>
                    {formatDate(chat.createdAt)}
                  </span>
                  <div className={styles.chatItemButtons}>
                    <button
                      className={styles.editButton}
                      onClick={(e) => startEditingTitle(e, chat.id, chat.title)}
                      aria-label="Edit title"
                    >
                      ✏️
                    </button>
                    <button
                      className={styles.deleteButton}
                      onClick={(e) => deleteChat(e, chat.id)}
                      aria-label="Delete chat"
                    >
                      🗑️
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {chatHistory.length === 0 && (
            <div className={styles.emptyChatList}>No chat history</div>
          )}
        </div>
      </div>

      <div
        className={styles.responsesContainer}
        ref={responsesContainerRef}
        onScroll={handleScroll}
      >
        {getVisibleMessages().length === 0 ? (
          <div className={styles.welcomeMessage}>
            <h1>Welcome to Chat</h1>
            <p>Start a conversation with the AI assistant.</p>
          </div>
        ) : (
          getVisibleMessages().map((message, index) => (
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
          ))
        )}

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
