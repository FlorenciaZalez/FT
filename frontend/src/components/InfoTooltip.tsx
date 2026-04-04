type InfoTooltipProps = {
  content: string | string[];
};

export default function InfoTooltip({ content }: InfoTooltipProps) {
  const items = Array.isArray(content)
    ? content.map((item) => item.trim()).filter(Boolean)
    : [content.trim()].filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return (
    <span className="group relative inline-flex items-center">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-400 transition group-hover:border-gray-400 group-hover:text-gray-500">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-max max-w-[240px] -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-left text-[11px] leading-relaxed text-white shadow-lg group-hover:block">
        {items.map((item) => (
          <span key={item} className="block">
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}