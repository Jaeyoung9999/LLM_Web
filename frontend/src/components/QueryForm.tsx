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

  const abortControllerRef = useRef<AbortController | null>(null);
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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event as unknown as FormEvent<HTMLFormElement>);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!prompt.trim()) return;

    // 이전 요청이 있다면 중단
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 새 요청을 위한 AbortController 생성
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);
    setResponseText(''); // Reset previous response text

    try {
      const eventSource = new EventSource(
        `http://localhost:8000/ask_query?prompt=${encodeURIComponent(prompt)}`,
      );

      eventSource.onmessage = (event) => {
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

      eventSource.onerror = (err) => {
        console.error('EventSource error:', err);
        eventSource.close();
        setIsLoading(false);
        setError('Connection error or stream ended');
      };

      // Stream complete
      eventSource.addEventListener('complete', () => {
        eventSource.close();
        setIsLoading(false);
      });

      // Clean up function to close connection if component unmounts
      return () => {
        eventSource.close();
        setIsLoading(false);
      };
    } catch (err) {
      setError(`Connection error: ${(err as Error).message}`);
      setIsLoading(false);
    }
  };

  // 컴포넌트 언마운트시 요청 중단
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
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
              type="submit"
              disabled={isLoading}
              className={styles.button}
            >
              {isLoading ? 'Processing...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
