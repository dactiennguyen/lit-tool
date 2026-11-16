import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Up to two initials: the first character of the first and last words,
 * skipping punctuation, so "Acc chính (me)" gives "AM", not "A(". Code points
 * are kept whole, so an emoji is not split in half.
 */
export function initials(label: string): string {
  const lead = (word: string) => Array.from(word).find((c) => !/\p{P}/u.test(c)) ?? "";
  const words = label.trim().split(/\s+/).map(lead).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : "";
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
