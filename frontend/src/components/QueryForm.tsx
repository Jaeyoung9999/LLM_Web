import { FormEvent, useState, useEffect, useRef } from 'react';
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

  return (
    <div className={styles.queryFormContainer}>
      <form onSubmit={handleSubmit}>
        <div className={styles.inputGroup}>
          <input
            type="text"
            id="promptInput"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your prompt here..."
            disabled={isLoading}
            className={styles.input}
          />
          <button type="submit" disabled={isLoading} className={styles.button}>
            {isLoading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </form>

      {error && <div className={styles.errorMessage}>{error}</div>}

      <div className={styles.responsesContainer}>
        {responseText && (
          <div className={styles.responseContent}>{responseText}</div>
        )}
      </div>
    </div>
  );
}
