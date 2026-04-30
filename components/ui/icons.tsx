"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AlertTriangle,
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  BarChart2,
  Bolt,
  Banknote,
  BookMarked,
  Boxes,
  Calculator,
  Bell,
  Calendar,
  CheckCircle2,
  Circle,
  CreditCard,
  Cpu,
  DollarSign,
  Copy,
  Database,
  ExternalLink,
  Info,
  Download,
  FileDown,
  FileText,
  FileSpreadsheet,
  Home,
  HelpCircle,
  Layers,
  Menu,
  Minus,
  Moon,
  ClipboardList,
  Clock,
  ChevronDown,
  ChevronLeft,
  CloudOff,
  Cloudy,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Layers3,
  Link2,
  LineChart,
  Monitor,
  Package,
  Pause,
  Play,
  PencilLine,
  PieChart,
  Plus,
  Sun,
  Radio,
  Radar,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Settings,
  Settings2,
  Store,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Trash2,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Truck,
  UtensilsCrossed,
  User,
  Users,
  WifiOff,
  XCircle,
  Wrench,
  X,
  Wallet,
  Workflow,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ListChecks,
  Mail,
  ChevronRight,
  ArchiveRestore,
  PackageSearch,
  Pencil,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Scale,
  BadgeCheck,
  Filter,
  Save,
} from "lucide-react";

// Lucide Animated (shadcn registry) — donde exista, preferimos estos.
export { XIcon } from "@/components/ui/x";
export { SearchIcon } from "@/components/ui/search";
export { ChevronDownIcon as ChevronDownAnimatedIcon } from "@/components/ui/chevron-down";
export { ChevronUpIcon as ChevronUpAnimatedIcon } from "@/components/ui/chevron-up";
export { ChevronLeftIcon as ChevronLeftAnimatedIcon } from "@/components/ui/chevron-left";
export { ChevronRightIcon as ChevronRightAnimatedIcon } from "@/components/ui/chevron-right";
export { MenuIcon as MenuAnimatedIcon } from "@/components/ui/menu";
export { BellIcon as BellAnimatedIcon } from "@/components/ui/bell";
export { SunIcon as SunAnimatedIcon } from "@/components/ui/sun";
export { MoonIcon as MoonAnimatedIcon } from "@/components/ui/moon";
export { RefreshCWIcon as RefreshCwAnimatedIcon } from "@/components/ui/refresh-cw";
export { SettingsIcon as SettingsAnimatedIcon } from "@/components/ui/settings";
export { UserIcon as UserAnimatedIcon } from "@/components/ui/user";
export { UsersIcon as UsersAnimatedIcon } from "@/components/ui/users";

function wrapLucide(Icon: LucideIcon, opts?: { hover?: "lift" | "spin" | "nudge" }) {
  const hover =
    opts?.hover === "spin"
      ? { rotate: 18, scale: 1.04 }
      : opts?.hover === "nudge"
        ? { x: 1, y: -1, scale: 1.03 }
        : { y: -1, scale: 1.03 };

  const Wrapped = React.forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => {
    return (
      <motion.span
        className={className}
        whileHover={hover}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
        aria-hidden={props["aria-label"] ? undefined : true}
      >
        <Icon ref={ref} {...props} className="h-full w-full" />
      </motion.span>
    );
  });

  Wrapped.displayName = `${Icon.displayName ?? Icon.name ?? "Icon"}Wrapped`;
  return Wrapped;
}

// Admin / navegación / acciones frecuentes (fallback animado) — mantener API lucide-react (size/className).
export const AlertTriangleIcon = wrapLucide(AlertTriangle, { hover: "nudge" });
export const ActivityIcon = wrapLucide(Activity, { hover: "lift" });
export const ArrowDownIcon = wrapLucide(ArrowDown, { hover: "nudge" });
export const ArrowLeftIcon = wrapLucide(ArrowLeft, { hover: "nudge" });
export const ArrowRightIcon = wrapLucide(ArrowRight, { hover: "nudge" });
export const ArrowRightLeftIcon = wrapLucide(ArrowRightLeft, { hover: "nudge" });
export const ArrowUpIcon = wrapLucide(ArrowUp, { hover: "nudge" });
export const ArrowUpDownIcon = wrapLucide(ArrowUpDown, { hover: "nudge" });
export const ArrowUpRightIcon = wrapLucide(ArrowUpRight, { hover: "nudge" });
export const BarChart3Icon = wrapLucide(BarChart3, { hover: "lift" });
export const BarChart2Icon = wrapLucide(BarChart2, { hover: "lift" });
export const BoltIcon = wrapLucide(Bolt, { hover: "lift" });
export const BanknoteIcon = wrapLucide(Banknote, { hover: "lift" });
export const BookMarkedIcon = wrapLucide(BookMarked, { hover: "lift" });
export const BoxesIcon = wrapLucide(Boxes, { hover: "lift" });
export const CalculatorIcon = wrapLucide(Calculator, { hover: "lift" });
export const BellLucideIcon = wrapLucide(Bell, { hover: "lift" });
export const CalendarIcon = wrapLucide(Calendar, { hover: "lift" });
export const CheckCircle2Icon = wrapLucide(CheckCircle2, { hover: "lift" });
export const CircleIcon = wrapLucide(Circle, { hover: "lift" });
export const CreditCardIcon = wrapLucide(CreditCard, { hover: "lift" });
export const CpuIcon = wrapLucide(Cpu, { hover: "lift" });
export const DollarSignIcon = wrapLucide(DollarSign, { hover: "lift" });
export const CopyIcon = wrapLucide(Copy, { hover: "lift" });
export const DatabaseIcon = wrapLucide(Database, { hover: "lift" });
export const ExternalLinkIcon = wrapLucide(ExternalLink, { hover: "nudge" });
export const InfoIcon = wrapLucide(Info, { hover: "lift" });
export const DownloadIcon = wrapLucide(Download, { hover: "lift" });
export const FileDownIcon = wrapLucide(FileDown, { hover: "lift" });
export const FileTextIcon = wrapLucide(FileText, { hover: "lift" });
export const FileSpreadsheetIcon = wrapLucide(FileSpreadsheet, { hover: "lift" });
export const HomeIcon = wrapLucide(Home, { hover: "lift" });
export const HelpCircleIcon = wrapLucide(HelpCircle, { hover: "lift" });
export const LayersIcon = wrapLucide(Layers, { hover: "lift" });
export const MenuLucideIcon = wrapLucide(Menu, { hover: "nudge" });
export const MinusIcon = wrapLucide(Minus, { hover: "lift" });
export const MoonLucideIcon = wrapLucide(Moon, { hover: "spin" });
export const ClipboardListIcon = wrapLucide(ClipboardList, { hover: "lift" });
export const ClockIcon = wrapLucide(Clock, { hover: "lift" });
export const CloudOffIcon = wrapLucide(CloudOff, { hover: "lift" });
export const CloudyIcon = wrapLucide(Cloudy, { hover: "lift" });
export const KeyRoundIcon = wrapLucide(KeyRound, { hover: "lift" });
export const LandmarkLucideIcon = wrapLucide(Landmark, { hover: "lift" });
export const LayoutDashboardIcon = wrapLucide(LayoutDashboard, { hover: "lift" });
export const LayoutGridIcon = wrapLucide(LayoutGrid, { hover: "lift" });
export const Layers3Icon = wrapLucide(Layers3, { hover: "lift" });
export const Link2Icon = wrapLucide(Link2, { hover: "nudge" });
export const LineChartIcon = wrapLucide(LineChart, { hover: "lift" });
export const MonitorIcon = wrapLucide(Monitor, { hover: "lift" });
export const PackageIcon = wrapLucide(Package, { hover: "lift" });
export const PauseIcon = wrapLucide(Pause, { hover: "lift" });
export const PlayIcon = wrapLucide(Play, { hover: "lift" });
export const PencilLineIcon = wrapLucide(PencilLine, { hover: "lift" });
export const PieChartIcon = wrapLucide(PieChart, { hover: "lift" });
export const PlusIcon = wrapLucide(Plus, { hover: "lift" });
export const SunLucideIcon = wrapLucide(Sun, { hover: "spin" });
export const RadioIcon = wrapLucide(Radio, { hover: "lift" });
export const RadarIcon = wrapLucide(Radar, { hover: "lift" });
export const ReceiptTextIcon = wrapLucide(ReceiptText, { hover: "lift" });
export const RefreshCwIcon = wrapLucide(RefreshCw, { hover: "spin" });
export const RotateCcwIcon = wrapLucide(RotateCcw, { hover: "spin" });
export const Rows3Icon = wrapLucide(Rows3, { hover: "lift" });
export const SearchLucideIcon = wrapLucide(Search, { hover: "lift" });
export const SettingsLucideIcon = wrapLucide(Settings, { hover: "spin" });
export const Settings2Icon = wrapLucide(Settings2, { hover: "spin" });
export const ShoppingBagIcon = wrapLucide(ShoppingBag, { hover: "lift" });
export const ShoppingCartIcon = wrapLucide(ShoppingCart, { hover: "lift" });
export const TagIcon = wrapLucide(Tag, { hover: "lift" });
export const Trash2Icon = wrapLucide(Trash2, { hover: "lift" });
export const ThumbsUpIcon = wrapLucide(ThumbsUp, { hover: "lift" });
export const TrendingDownIcon = wrapLucide(TrendingDown, { hover: "nudge" });
export const TrendingUpIcon = wrapLucide(TrendingUp, { hover: "nudge" });
export const TruckIcon = wrapLucide(Truck, { hover: "nudge" });
export const UtensilsCrossedIcon = wrapLucide(UtensilsCrossed, { hover: "lift" });
export const UserLucideIcon = wrapLucide(User, { hover: "lift" });
export const UsersLucideIcon = wrapLucide(Users, { hover: "lift" });
export const WifiOffIcon = wrapLucide(WifiOff, { hover: "lift" });
export const XCircleIcon = wrapLucide(XCircle, { hover: "lift" });
export const WalletIcon = wrapLucide(Wallet, { hover: "lift" });
export const WorkflowIcon = wrapLucide(Workflow, { hover: "lift" });
export const WrenchIcon = wrapLucide(Wrench, { hover: "lift" });
export const XLucideIcon = wrapLucide(X, { hover: "lift" });
export const EyeIcon = wrapLucide(Eye, { hover: "lift" });
export const EyeOffIcon = wrapLucide(EyeOff, { hover: "lift" });
export const Loader2Icon = wrapLucide(Loader2, { hover: "spin" });
export const LockIcon = wrapLucide(Lock, { hover: "lift" });
export const ListChecksIcon = wrapLucide(ListChecks, { hover: "lift" });
export const MailIcon = wrapLucide(Mail, { hover: "lift" });
export const ChevronRightIcon = wrapLucide(ChevronRight, { hover: "nudge" });
export const ChevronDownIcon = wrapLucide(ChevronDown, { hover: "nudge" });
export const ChevronLeftIcon = wrapLucide(ChevronLeft, { hover: "nudge" });
export const ArchiveRestoreIcon = wrapLucide(ArchiveRestore, { hover: "lift" });
export const PackageSearchIcon = wrapLucide(PackageSearch, { hover: "lift" });
export const PencilIcon = wrapLucide(Pencil, { hover: "lift" });
export const ShieldIcon = wrapLucide(Shield, { hover: "lift" });
export const ShieldAlertIcon = wrapLucide(ShieldAlert, { hover: "lift" });
export const ShieldCheckIcon = wrapLucide(ShieldCheck, { hover: "lift" });
export const SparklesIcon = wrapLucide(Sparkles, { hover: "lift" });
export const ScaleIcon = wrapLucide(Scale, { hover: "lift" });
export const BadgeCheckIcon = wrapLucide(BadgeCheck, { hover: "lift" });
export const FilterIcon = wrapLucide(Filter, { hover: "lift" });
export const SaveIcon = wrapLucide(Save, { hover: "lift" });
export const StoreIcon = wrapLucide(Store, { hover: "lift" });

