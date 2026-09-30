import {
  Bike,
  BookOpen,
  Brain,
  Drama,
  Dumbbell,
  GraduationCap,
  type LucideIcon,
  Medal,
  Music,
  Palette,
  PersonStanding,
  Shapes,
  Shield,
  Target,
  Trophy,
  Volleyball,
  Waves,
} from "lucide-react";
import { type ActivityIconName, isActivityIcon } from "@/lib/activities";
import { cn } from "@/lib/utils";

const ICONS: Record<ActivityIconName, LucideIcon> = {
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  shield: Shield,
  music: Music,
  trophy: Trophy,
  shapes: Shapes,
  dumbbell: Dumbbell,
  waves: Waves,
  drama: Drama,
  palette: Palette,
  medal: Medal,
  target: Target,
  bike: Bike,
  volleyball: Volleyball,
  "person-standing": PersonStanding,
  brain: Brain,
};

// A module's icon; a name outside the set shows the generic one.
export function ActivityIcon({ name, className }: { name: string; className?: string }) {
  const Icon = isActivityIcon(name) ? ICONS[name] : Shapes;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
