import { useEffect, useState } from 'react';

export default function SuccessToast({
  message,
  onClose,
  duration = 3500,
}: {
  message: string;
  onClose: () => void;
  duration?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enterTimer = window.setTimeout(() => setVisible(true), 10);
    const exitTimer = window.setTimeout(() => setVisible(false), Math.max(duration - 300, 0));
    const closeTimer = window.setTimeout(onClose, duration);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(closeTimer);
    };
  }, [duration, onClose]);

  return (
    <div
      className={`pointer-events-none fixed right-6 top-6 z-[80] max-w-sm rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 shadow-lg transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      {message}
    </div>
  );
}