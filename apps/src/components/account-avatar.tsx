import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Up to two initials; iterates code points so emoji aren't split in half. */
export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const firstChar = (s: string | undefined) => (s ? (Array.from(s)[0] ?? "") : "");
  const first = firstChar(parts[0]) || "?";
  const last = parts.length > 1 ? firstChar(parts[parts.length - 1]) : "";
  return (first + last).toUpperCase();
}

type Size = "sm" | "default" | "lg";

export function AccountAvatar({ label, size = "default" }: { label: string; size?: Size }) {
  return (
    <Avatar size={size}>
      <AvatarFallback className="bg-primary/10 font-medium text-primary">{initials(label)}</AvatarFallback>
    </Avatar>
  );
}

/** Avatar for another person: remote image when there is one, initials otherwise. */
export function PersonAvatar({
  name,
  src,
  alt = "",
  size = "default",
  className,
}: {
  name: string;
  src: string | null;
  alt?: string;
  size?: Size;
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {src && <AvatarImage src={src} alt={alt} referrerPolicy="no-referrer" />}
      <AvatarFallback className={cn(className && "text-lg")}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
