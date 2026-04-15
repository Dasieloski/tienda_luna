"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight, CheckCircle2, Circle, Pause, Play, RotateCcw } from "lucide-react";

/**
 * Weekly Progress Chart - Crextio Style
 * Shows bar chart for each day of the week
 */
interface WeeklyProgressProps {
  data: { day: string; value: number; isToday?: boolean }[];
  label?: string;
  total?: string;
  subtitle?: string;
  className?: string;
}

export function WeeklyProgress({
  data,
  label = "Progreso",
  total = "6.1h",
  subtitle = "Esta semana",
  className,
}: WeeklyProgressProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={cn("tl-card tl-card-hover group p-5", className)}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-tl-ink">{label}</h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-tl-ink">{total}</span>
            <span className="text-xs text-tl-muted">{subtitle}</span>
          </div>
        </div>
        <button
          type="button"
          className="tl-interactive tl-press tl-focus flex h-8 w-8 items-center justify-center rounded-lg bg-tl-canvas-subtle text-tl-muted transition-colors hover:bg-tl-accent hover:text-tl-accent-fg"
        >
          <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
        </button>
      </div>

      {/* Weekly bars */}
      <div className="mt-6 flex items-end justify-between gap-2">
        {data.map((item, i) => {
          const height = (item.value / maxValue) * 100;
          return (
            <div key={i} className="group/bar flex flex-col items-center gap-2">
              <div className="relative h-24 w-8">
                {/* Tooltip on hover */}
                {item.value > 0 && (
                  <div className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 rounded-md bg-tl-secondary px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100">
                    {item.value}h
                  </div>
                )}
                <div
                  className={cn(
                    "absolute bottom-0 w-full rounded-t-lg transition-[height,background-color] duration-200 ease-out group-hover/bar:opacity-95",
                    item.isToday ? "bg-tl-accent" : "bg-tl-canvas-subtle"
                  )}
                  style={{ height: `${Math.max(height, 8)}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium uppercase",
                  item.isToday ? "text-tl-ink" : "text-tl-muted"
                )}
              >
                {item.day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Time Tracker - Crextio Style
 * Circular progress with timer display
 */
interface TimeTrackerProps {
  time: string;
  label?: string;
  progress?: number; // 0-100
  isRunning?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  className?: string;
}

export function TimeTracker({
  time = "02:35",
  label = "Tiempo de trabajo",
  progress = 65,
  isRunning = false,
  onPlay,
  onPause,
  onReset,
  className,
}: TimeTrackerProps) {
  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn("tl-card tl-card-hover group p-5", className)}>
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-tl-ink">Time tracker</h3>
        <button
          type="button"
          className="tl-interactive tl-press tl-focus flex h-8 w-8 items-center justify-center rounded-lg bg-tl-canvas-subtle text-tl-muted transition-colors hover:bg-tl-accent hover:text-tl-accent-fg"
        >
          <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
        </button>
      </div>

      {/* Circular progress */}
      <div className="mt-4 flex flex-col items-center">
        <div className="relative">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
            {/* Background circle */}
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="var(--tl-canvas-subtle)"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="var(--tl-accent)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-500"
            />
            {/* Tick marks */}
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 30 * Math.PI) / 180;
              const x1 = 60 + 42 * Math.cos(angle);
              const y1 = 60 + 42 * Math.sin(angle);
              const x2 = 60 + 46 * Math.cos(angle);
              const y2 = 60 + 46 * Math.sin(angle);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--tl-line)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums text-tl-ink">{time}</span>
            <span className="text-[10px] uppercase tracking-wider text-tl-muted">{label}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={isRunning ? onPause : onPlay}
            className="tl-interactive tl-press tl-focus flex h-10 w-10 items-center justify-center rounded-full bg-tl-canvas-subtle text-tl-ink transition-colors hover:bg-tl-accent hover:text-tl-accent-fg"
          >
            {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="tl-interactive tl-press tl-focus flex h-10 w-10 items-center justify-center rounded-full bg-tl-canvas-subtle text-tl-muted transition-colors hover:bg-tl-secondary hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Task Progress Card - Crextio Style
 * Shows onboarding/task completion progress
 */
interface TaskItem {
  id: string;
  title: string;
  time?: string;
  completed?: boolean;
  icon?: React.ReactNode;
}

interface TaskProgressProps {
  title?: string;
  tasks: TaskItem[];
  completedCount?: number;
  totalCount?: number;
  className?: string;
}

export function TaskProgress({
  title = "Tareas del día",
  tasks,
  completedCount,
  totalCount,
  className,
}: TaskProgressProps) {
  const completed = completedCount ?? tasks.filter((t) => t.completed).length;
  const total = totalCount ?? tasks.length;
  const percentage = Math.round((completed / total) * 100);

  return (
    <div className={cn("tl-card-dark tl-card-hover group p-5", className)}>
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-2xl font-bold tabular-nums text-white">
          {completed}/{total}
        </span>
      </div>

      {/* Progress indicators */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex gap-1.5">
          {[30, 25, 0].map((val, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-semibold",
                val > 0 ? "bg-tl-accent text-tl-accent-fg" : "bg-white/10 text-white/50"
              )}
            >
              {val}%
            </div>
          ))}
        </div>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-tl-accent transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="mt-4 space-y-2">
        {tasks.slice(0, 5).map((task) => (
          <div
            key={task.id}
            className="group/task tl-interactive flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 transition-colors duration-200 hover:bg-white/10"
          >
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover/task:scale-110",
                task.completed ? "bg-tl-success/20 text-tl-success" : "bg-tl-accent text-tl-accent-fg"
              )}
            >
              {task.completed ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : task.icon ? (
                task.icon
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", task.completed ? "text-white/50 line-through" : "text-white")}>
                {task.title}
              </p>
              {task.time && (
                <p className="text-xs text-white/40">{task.time}</p>
              )}
            </div>
            {task.completed && (
              <CheckCircle2 className="h-4 w-4 text-tl-success" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stat Display - Large numbers with icons (Crextio style)
 */
interface StatDisplayProps {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatDisplay({ value, label, icon, className }: StatDisplayProps) {
  return (
    <div className={cn("group flex items-center gap-2", className)}>
      <span className="text-4xl font-bold tabular-nums tracking-tight text-tl-ink">
        {value}
      </span>
      <div className="flex flex-col">
        {icon && (
          <span className="text-tl-muted transition-transform duration-200 group-hover:scale-105">{icon}</span>
        )}
        <span className="text-xs text-tl-muted">{label}</span>
      </div>
    </div>
  );
}
