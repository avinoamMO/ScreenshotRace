import { useState, useEffect, useRef } from 'react';

interface StopwatchProps {
  isRunning: boolean;
}

export function Stopwatch({ isRunning }: StopwatchProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now() - elapsedTime;

      const updateTimer = () => {
        if (startTimeRef.current !== null) {
          setElapsedTime(Date.now() - startTimeRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(updateTimer);
      };

      animationFrameRef.current = requestAnimationFrame(updateTimer);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Reset when stopped
      if (!isRunning && elapsedTime > 0) {
        // Keep the final time displayed
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRunning]);

  // Reset when starting a new race
  useEffect(() => {
    if (isRunning) {
      setElapsedTime(0);
      startTimeRef.current = Date.now();
    }
  }, [isRunning]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }
    return `${seconds}.${milliseconds.toString().padStart(2, '0')}s`;
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        {/* Stopwatch icon */}
        <svg
          className={`w-8 h-8 ${isRunning ? 'text-green-400' : 'text-gray-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <circle cx="12" cy="13" r="8" strokeWidth={2} />
          <path strokeLinecap="round" strokeWidth={2} d="M12 9v4l2 2" />
          <path strokeLinecap="round" strokeWidth={2} d="M12 5V3" />
          <path strokeLinecap="round" strokeWidth={2} d="M10 3h4" />
        </svg>
        {isRunning && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
        )}
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums">
        <span className={isRunning ? 'text-green-400' : 'text-gray-300'}>
          {formatTime(elapsedTime)}
        </span>
      </div>
    </div>
  );
}
