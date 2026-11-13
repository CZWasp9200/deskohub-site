import type { ReactNode } from "react";

/**
 * Plain page heading for pages that have no hero photo (account, events,
 * membership). Matches the dark heading style of the hero sections.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: ReactNode;
}) {
  return (
    <section className="border-b border-gray-800 bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-3 text-4xl font-bold text-green-400 md:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="max-w-2xl text-lg text-gray-300">{subtitle}</p>
        )}
        {children}
      </div>
    </section>
  );
}
