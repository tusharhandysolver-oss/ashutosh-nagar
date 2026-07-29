/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Task, TaskStage, User } from "../types";
import { MoveRight, MoveLeft, Sparkles, AlertCircle, Plus, Eye, Scale, Play, Pause, Clock, Info } from "lucide-react";

interface KanbanViewProps {
  tasks: Task[];
  users: User[];
  onSelectTask: (task: Task) => void;
  onUpdateStage: (taskId: string, stage: TaskStage) => void;
  onCreateTaskQuick: (stage: TaskStage) => void;
  onPlayTask?: (task: Task) => void;
  onPauseTask?: (task: Task) => void;
}

const STAGES: TaskStage[] = ["Case Intake", "In Progress", "Completed"];

export default function KanbanView({ tasks, users, onSelectTask, onUpdateStage, onCreateTaskQuick, onPlayTask, onPauseTask }: KanbanViewProps) {
  const [filterProject, setFilterProject] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [showStageLegend, setShowStageLegend] = useState(false);

  // Clean list of unique projects for simple filtering
  const projects = Array.from(new Set(tasks.map((t) => t.projectName))).filter(Boolean);

  // Filter conditions
  const filteredTasks = tasks.filter((t) => {
    const matchProject = filterProject ? t.projectName === filterProject : true;
    const matchPriority = filterPriority ? t.priority === filterPriority : true;
    const matchUser = filterUser ? t.assignedTo === filterUser : true;
    return matchProject && matchPriority && matchUser;
  });

  function getTasksByStage(stage: TaskStage) {
    // Render from workflow truth even if an older stored record has a stale stage.
    const stageTasks = filteredTasks.filter((t) => {
      const effectiveStage: TaskStage = t.status === "Completed"
        ? "Completed"
        : t.timerState === "running"
          ? "In Progress"
          : t.stage;
      return effectiveStage === stage;
    });
    // Sort logic: 
    // 1. Progress started (timerState === "running") comes first
    // 2. Then latest cards top (createdAt descending)
    return [...stageTasks].sort((a, b) => {
      const aRunning = a.timerState === "running" ? 1 : 0;
      const bRunning = b.timerState === "running" ? 1 : 0;
      if (aRunning !== bRunning) {
        return bRunning - aRunning; // Put running on top
      }
      
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  // Shift Stage Handlers
  function handleMoveLeft(taskId: string, currentStage: TaskStage) {
    const currentIdx = STAGES.indexOf(currentStage);
    if (currentIdx > 0) {
      onUpdateStage(taskId, STAGES[currentIdx - 1]);
    }
  }

  function handleMoveRight(taskId: string, currentStage: TaskStage) {
    const currentIdx = STAGES.indexOf(currentStage);
    if (currentIdx < STAGES.length - 1) {
      onUpdateStage(taskId, STAGES[currentIdx + 1]);
    }
  }

  const getStageLabel = (stage: TaskStage) => {
    return stage;
  };

  const getPriorityBadgeClass = (p: string) => {
    switch (p) {
      case "Critical":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "High":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "Medium":
        return "bg-sky-50 text-sky-700 border-sky-200";
      default:
        return "bg-slate-50 text-slate-650 border-slate-200";
    }
  };

  return (
    <div className="space-y-6 text-slate-800 h-full flex flex-col">
      
      {/* Top filter menu */}
      <div className="workspace-hero flex flex-col xl:flex-row xl:items-center justify-between gap-5 p-5 sm:p-6 rounded-3xl soft-shadow">
        <div className="flex items-center gap-3 self-start min-w-0">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-950 text-white shadow-lg shadow-blue-950/20"><Scale className="h-5 w-5" /></div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-blue-700">Matter workflow</p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-950">Task Board</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
          <div className="relative">
            <button type="button" onClick={() => setShowStageLegend(value => !value)} aria-expanded={showStageLegend} className="legend-trigger"><Info className="h-4 w-4" />Stage key</button>
            {showStageLegend && (
              <div role="dialog" aria-label="Task stage legend" className="context-legend absolute left-0 xl:left-auto xl:right-0 top-12 z-[60] w-[min(350px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl animate-dropdown-in">
                <div className="space-y-1">
                  <div className="legend-row"><span className="legend-swatch bg-sky-500"/><span><strong>Case Intake</strong><small>Created and ready to begin</small></span></div>
                  <div className="legend-row"><span className="legend-swatch bg-amber-500"/><span><strong>In Progress</strong><small>Timer started or work underway</small></span></div>
                  <div className="legend-row"><span className="legend-swatch bg-emerald-500"/><span><strong>Completed</strong><small>Automatically used when marked complete</small></span></div>
                </div>
                <div className="workflow-legend-note"><strong>Automatic flow:</strong> New case → Case Intake, timer started → In Progress, complete marked → Completed.</div>
              </div>
            )}
          </div>
          {/* Project Filtering */}
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="flex-1 md:flex-none rounded-full bg-slate-50 border border-slate-200 px-3.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-800 cursor-pointer font-medium"
          >
            <option value="">All Matters</option>
            {projects.map((name, i) => (
              <option key={i} value={name}>{name}</option>
            ))}
          </select>

          {/* Priority Filtering */}
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="flex-1 md:flex-none rounded-full bg-slate-50 border border-slate-200 px-3.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-800 cursor-pointer font-medium"
          >
            <option value="">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          {/* Team Member Filtering */}
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="flex-1 md:flex-none rounded-full bg-slate-50 border border-slate-200 px-3.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-hidden focus:border-blue-800 cursor-pointer font-medium"
          >
            <option value="">All Members</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>

          {/* Preset trigger to clear filters */}
          {(filterProject || filterPriority || filterUser) && (
            <button
              onClick={() => { setFilterProject(""); setFilterPriority(""); setFilterUser(""); }}
              className="text-xs text-blue-900 hover:text-blue-950 font-bold px-2 py-1 underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Kanban Board Horizontal Grid */}
      <div className="flex-1 pb-4 select-none min-w-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          
          {STAGES.map((stage, stageIndex) => {
            const stageTasks = getTasksByStage(stage);
            return (
              <div
                key={stage}
                style={{ animationDelay: `${stageIndex * 85}ms` }}
                className="kanban-column-enter premium-panel bg-slate-50 border border-slate-200/60 min-w-0 rounded-3xl p-4 xl:p-5 flex flex-col space-y-4 max-h-[680px] overflow-hidden"
              >
                {/* Column header */}
                <div className="flex items-center justify-between border-b border-slate-150 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${
                      stage === "Case Intake" ? "bg-sky-500" :
                      stage === "In Progress" ? "bg-amber-500" : "bg-emerald-500"
                    }`} />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 font-display">
                      {getStageLabel(stage)}
                    </h3>
                  </div>
                  <span className="text-xs bg-slate-150 text-slate-500 font-bold px-2.5 py-0.5 rounded-full border border-slate-200">
                    {stageTasks.length}
                  </span>
                </div>

                {/* Task list container */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {stageTasks.map((task) => {
                    const assigneeUser = users.find((u) => u.id === task.assignedTo);
                    const isCompleted = task.status === "Completed";
                    const dueDatePassed = new Date(task.dueDate).getTime() < Date.now();
                    const isOverdue = !isCompleted && dueDatePassed;
                    
                    return (
                      <div
                        key={task.id}
                        className={`hover-lift soft-shadow group relative rounded-2xl transition-all cursor-pointer p-5 border hover:shadow-lg ${
                          isOverdue
                              ? "bg-rose-50/10 border-rose-300 hover:border-rose-500"
                              : isCompleted
                                ? "bg-amber-50/10 border-amber-200 hover:border-amber-300"
                                : "bg-white border-slate-200 hover:border-blue-800"
                        }`}
                      >
                        {/* Task priority status indicators */}
                        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getPriorityBadgeClass(task.priority)}`}>
                              {task.priority}
                            </span>

                            {/* Status Badge Custom Styling */}
                            {(() => {
                              if (isCompleted) {
                                return (
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-amber-100 text-blue-900 border-amber-200">
                                    Completed
                                  </span>
                                );
                              }
                              if (isOverdue) {
                                return (
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-rose-100 text-rose-700 border-rose-200">
                                    Overdue
                                  </span>
                                );
                              }
                              if (task.status === "In Progress") {
                                return (
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                                    In Progress
                                  </span>
                                );
                              }
                              return (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-slate-50 text-slate-650 border-slate-200">
                                  {task.status}
                                </span>
                              );
                            })()}

                            {task.timerState === "running" && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-white animate-pulse">
                                Running
                              </span>
                            )}
                            {task.timerState === "paused" && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white">
                                Paused
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 font-mono font-bold">{task.id.slice(-4).toUpperCase()}</span>
                        </div>

                        {/* Title & Description */}
                        <div onClick={() => onSelectTask(task)} className="space-y-1.5">
                          <h4 className={`text-sm font-bold group-hover:text-blue-900 transition-colors tracking-tight line-clamp-1 ${
                            isCompleted
                                ? "text-slate-500 line-through"
                                : "text-slate-800"
                          }`}>
                            {task.title}
                          </h4>
                          <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">
                            {task.description}
                          </p>
                        </div>

                        {/* Project Subtext tag */}
                        <div className="pt-3 flex items-center justify-between gap-2">
                          <span className="text-xs bg-slate-50 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-150 truncate font-medium">
                            {task.projectName}
                          </span>
                          {task.totalActiveMs ? (
                            <span className="text-xs font-mono font-bold text-blue-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap">
                              ⏱️ {(task.totalActiveMs / (1000 * 60 * 60)).toFixed(1)}h
                            </span>
                          ) : null}
                        </div>

                        {/* Assignee & Move Coordinates Controls */}
                        <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-slate-100">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={assigneeUser?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=40"}
                              alt={assigneeUser?.name}
                              referrerPolicy="no-referrer"
                              className="h-5.5 w-5.5 rounded-full object-cover border border-slate-200"
                            />
                            <span className="text-xs font-medium text-slate-650 truncate">{assigneeUser?.name?.split(" ")[0]}</span>
                          </div>

                          {/* Navigation micro-arrows for stage manipulation */}
                          <div className="flex items-center gap-1.5">
                            <button
                              title="Move back a stage"
                              disabled={stage === "Case Intake"}
                              onClick={(e) => { e.stopPropagation(); handleMoveLeft(task.id, stage); }}
                              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-20 transition-all cursor-pointer"
                            >
                              <MoveLeft className="h-3.5 w-3.5" />
                            </button>

                            {task.status !== "Completed" && (
                              task.timerState === "running" ? (
                                <button
                                  title="Pause Active Timer"
                                  onClick={(e) => { e.stopPropagation(); onPauseTask?.(task); }}
                                  className="rounded-full p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-600 transition-all cursor-pointer"
                                >
                                  <Pause className="h-3.5 w-3.5 fill-amber-500" />
                                </button>
                              ) : (
                                <button
                                  title="Start/Resume Timer"
                                  onClick={(e) => { e.stopPropagation(); onPlayTask?.(task); }}
                                  className="rounded-full p-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-all cursor-pointer"
                                >
                                  <Play className="h-3.5 w-3.5 fill-emerald-600" />
                                </button>
                              )
                            )}

                            <button
                              title="View case details"
                              onClick={(e) => { e.stopPropagation(); onSelectTask(task); }}
                              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-850 transition-all cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              title="Move forward a stage"
                              disabled={stage === "Completed"}
                              onClick={(e) => { e.stopPropagation(); handleMoveRight(task.id, stage); }}
                              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-20 transition-all cursor-pointer"
                            >
                              <MoveRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Overdue alert indicator badge */}
                        {isOverdue && (
                          <div className="absolute top-2.5 right-2.5 flex items-center text-rose-600" title="Overdue">
                            <AlertCircle className="h-4 w-4 animate-pulse" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {stageTasks.length === 0 && (
                    <div className="text-center py-14 text-xs text-slate-400 border border-dashed border-slate-200 bg-white/40 rounded-2xl transition-colors hover:border-slate-300">
                      No tasks here
                    </div>
                  )}
                </div>

              </div>
            );
          })}

        </div>
      </div>

    </div>
  );
}
