import { FormEvent, useState, useEffect, useRef, KeyboardEvent } from 'react';
import styles from './QueryForm.module.scss';

type QueryResponse = {
  status: string;
  data: string;
};

export default function QueryForm() {
  const [prompt, setPrompt] = useState<string>('');
  const [responseText, setResponseText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // textarea 높이 자동 조절
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 168)}px`; // 7줄 * 24px 높이
    }
  };

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

    setIsLoading(true);
    setError(null);
    setResponseText(''); // Reset previous response text

    try {
      eventSourceRef.current = new EventSource(
        `http://localhost:8000/ask_query?prompt=${encodeURIComponent(prompt)}`,
      );

      eventSourceRef.current.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data) as QueryResponse;
          // Filter out the "Stream finished" message and only append meaningful data
          if (parsedData.data !== 'Stream finished') {
            // Make sure newlines are preserved
            const formattedData = parsedData.data;
            setResponseText((prev) => prev + formattedData);
          }
        } catch (e) {
          console.error('Error parsing event data:', event.data, e);
        }
      };

      eventSourceRef.current.onerror = (err) => {
        console.error('EventSource error:', err);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsLoading(false);
        setError('Connection error or stream ended');
      };

      // Stream complete
      eventSourceRef.current.addEventListener('complete', () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsLoading(false);
      });
    } catch (err) {
      setError(`Connection error: ${(err as Error).message}`);
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
      setResponseText((prev) => prev + '\n[생성 중단됨]');
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
      <div className={styles.responsesContainer}>
        {responseText && (
          <div className={styles.responseContent}>{responseText}</div>
        )}
      </div>

      <div className={styles.inputSection}>
        {error && <div className={styles.errorMessage}>{error}</div>}

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
