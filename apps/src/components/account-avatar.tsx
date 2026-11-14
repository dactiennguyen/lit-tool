import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function AccountAvatar({ label, size = "default" }: { label: string; size?: "sm" | "default" | "lg" }) {
  return (
    <Avatar size={size}>
      <AvatarFallback className="bg-primary/10 font-medium text-primary">{initials(label)}</AvatarFallback>
    </Avatar>
  );
}
