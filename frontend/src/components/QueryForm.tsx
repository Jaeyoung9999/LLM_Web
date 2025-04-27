import {
  FormEvent,
  useState,
  useEffect,
  useRef,
  KeyboardEvent,
  useCallback,
} from 'react';
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
  // error state 제거

  const eventSourceRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const responsesContainerRef = useRef<HTMLDivElement | null>(null);

  // textarea 높이 자동 조절
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 168)}px`; // 7줄 * 24px 높이
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
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 20; // 10px 정도의 여유를 둠

      setIsAutoScroll(isAtBottom);
    }
  };

  // 새 메시지가 추가될 때마다 스크롤
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 키보드 이벤트 처리
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isLoading) {
      event.preventDefault();
      handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isLoading) return; // 이미 로딩 중이면 중복 실행 방지

    if (!prompt.trim()) return;

    // 사용자 메시지 추가
    const userMessage = prompt.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    // 어시스턴트 메시지를 스트리밍 상태로 추가
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isStreaming: true },
    ]);

    setPrompt(''); // 입력 필드 초기화
    setIsLoading(true);
    setIsAutoScroll(true); // 새 메시지를 보낼 때 자동 스크롤 활성화
    // error 관련 코드 제거

    try {
      eventSourceRef.current = new EventSource(
        `http://localhost:8000/ask_query?prompt=${encodeURIComponent(userMessage)}`,
      );

      eventSourceRef.current.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data) as QueryResponse;

          if (parsedData.data === 'Stream finished') {
            // 스트림이 끝났을 때 처리
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
            setIsLoading(false);

            // 스트리밍 상태 해제
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.isStreaming) {
                lastMessage.isStreaming = false;
              }
              return newMessages;
            });
          } else {
            // 메시지 내용 업데이트
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

        // 스트리밍 상태 해제
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
    event.preventDefault(); // 이벤트 전파 방지
    event.stopPropagation(); // 이벤트 버블링 방지

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsLoading(false);

      // 중단된 응답 처리
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

  // 컴포넌트 언마운트시 정리
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // textarea 높이 조절
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
              {message.content}
              {message.isStreaming && <span className={styles.cursor}>▋</span>}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputSection}>
        {/* error 메시지 표시 제거 */}

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
