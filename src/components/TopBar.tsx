import React, { useEffect, useState, useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { TimelineState } from '../types/timeline';
import { Video, Sparkles, Palette, Volume2, Share2, Magnet, Cpu, Zap, Download, ShieldAlert, FlaskConical } from 'lucide-react';
import { getRuntimeMode, setRuntimeMode, subscribeRuntimeMode, isDemoModeAvailable, RuntimeMode } from '../services/runtimeConfig';
import { serializeProject, deserializeProject } from '../core/project/serialize';
import { useMediaPoolStore } from '../store/mediaPool';

export const TopBar: React.FC = () => {
  const { assets: mediaPoolAssets, addAsset } = useMediaPoolStore();
  const {
    activeWorkspace, setWorkspace,
    magneticSnapping, toggleMagneticSnapping,
    metadata,
    undo, redo, splitClip, selectedClipIds, playheadPosition,
    setZoomLevel, zoomLevel, addTrack
  } = useTimelineStore();

  const [runtimeMode, setMode] = useState<RuntimeMode>(getRuntimeMode());
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeRuntimeMode((newMode) => {
      setMode(newMode);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleRuntimeMode = () => {
    // Dev-only affordance. The toggle is not rendered in a release build, and setRuntimeMode
    // refuses demo mode there regardless, so this cannot fabricate a demo session.
    setRuntimeMode(runtimeMode === 'live' ? 'demo' : 'live');
  };
  const demoModeAvailable = isDemoModeAvailable();

  const menus = React.useMemo<Record<string, { label?: string; action?: () => void; divider?: boolean }[]>>(() => ({
    File: [
      { label: 'Save Project', action: () => {
        const state = useTimelineStore.getState();
        try {
          const jsonString = serializeProject(state, mediaPoolAssets);
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'project.cinecraft';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('Failed to save project', err);
          alert('Failed to save project. Ensure all fields are filled.');
        }
      } },
      { label: 'Open Project', action: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.cinecraft,application/json';
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (re) => {
            try {
              const text = re.target?.result as string;
              const { timelineState, assets } = deserializeProject(text);

              // Load assets into media pool
              for (const a of assets) {
                addAsset(a);
              }

              // Set timeline state
              useTimelineStore.setState({
                version: timelineState.version,
                projectId: timelineState.projectId,
                metadata: timelineState.metadata,
                tracks: timelineState.tracks,
                playheadPosition: { value: 0, rate: 1 },
                selectedClipIds: []
              });
            } catch (err) {
              console.error('Failed to open project', err);
              alert('Failed to open project file: Invalid format');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      } },
      { divider: true },
      { label: 'Export...', action: () => setWorkspace('export') },
    ],
    Edit: [
      { label: 'Undo', action: () => undo() },
      { label: 'Redo', action: () => redo() },
      { divider: true },
      { label: 'Split at Playhead', action: () => {
        if (selectedClipIds.length > 0) {
          splitClip(selectedClipIds[0], playheadPosition);
        }
      } },
    ],
    View: [
      { label: 'Zoom In', action: () => setZoomLevel(zoomLevel + 5) },
      { label: 'Zoom Out', action: () => setZoomLevel(zoomLevel - 5) },
      { label: 'Reset Zoom', action: () => setZoomLevel(20) },
      { divider: true },
      { label: 'Toggle Snapping', action: () => toggleMagneticSnapping() },
    ],
    Clip: [
    ],
    Sequence: [
      { label: 'Add Video Track', action: () => addTrack('video') },
      { label: 'Add Audio Track', action: () => addTrack('audio') },
    ],
    Effects: [
    ],
    Help: [
    ]
  }), [undo, redo, splitClip, selectedClipIds, playheadPosition, setZoomLevel, zoomLevel, toggleMagneticSnapping, addTrack, setWorkspace]);

  const workspaces: { id: TimelineState['activeWorkspace']; label: string; icon: React.ReactNode }[] = [
    { id: 'edit', label: 'Edit & Cut', icon: <Video className="w-3.5 h-3.5 mr-1 shrink-0" /> },
    { id: 'ai', label: 'AI Copilot', icon: <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-accent animate-pulse shrink-0" /> },
    { id: 'color', label: 'Color & FX', icon: <Palette className="w-3.5 h-3.5 mr-1 shrink-0" /> },
    { id: 'audio', label: 'Audio', icon: <Volume2 className="w-3.5 h-3.5 mr-1 shrink-0" /> },
    { id: 'export', label: 'Export', icon: <Share2 className="w-3.5 h-3.5 mr-1 shrink-0" /> },
  ];

  return (
    <header className="h-11 bg-dark-950/90 backdrop-blur border-b border-subtle flex items-center justify-between px-3 text-xs select-none text-neutral-300 z-30 shrink-0">
      {/* Left: App Logo & Menu */}
      <div className="flex items-center space-x-3 shrink-0">
        <div className="flex items-center space-x-2 font-bold text-neutral-100 tracking-wider">
          <div className="bg-gradient-to-tr from-indigo-accent via-purple-600 to-teal-accent p-1 rounded-md shadow-lg shadow-indigo-500/20">
            <Zap className="w-3.5 h-3.5 text-white fill-white" />
          </div>
          <span className="font-extrabold bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent text-sm">
            CINECRAFT<span className="text-indigo-accent font-mono text-xs ml-1 font-semibold">PRO</span>
          </span>
        </div>

        <div className="h-4 w-[1px] bg-neutral-800" />

        <nav ref={menuRef} className="hidden xl:flex items-center space-x-2.5 text-neutral-400 text-[11px] font-medium relative">
          {Object.entries(menus).map(([menuName, menuItems]) => (
            <div key={menuName} className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === menuName ? null : menuName)}
                className={`hover:text-neutral-100 cursor-pointer transition-colors px-2 py-1 rounded ${
                  openMenu === menuName ? 'bg-dark-800 text-neutral-100' : 'hover:bg-dark-800'
                }`}
              >
                {menuName}
              </button>

              {openMenu === menuName && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-dark-900 border border-subtle rounded-panel shadow-xl py-1 z-50">
                  {menuItems.map((item, idx) =>
                    item.divider ? (
                      <div key={idx} className="h-px bg-subtle my-1" />
                    ) : (
                      <button
                        key={idx}
                        onClick={() => {
                          item.action?.();
                          setOpenMenu(null);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-indigo-accent hover:text-white transition-colors text-neutral-300 flex items-center justify-between group"
                      >
                        <span>{item.label}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Center: Workspaces Mode Switcher */}
      <div className="hidden md:flex items-center bg-dark-900 p-0.5 rounded-panel border border-subtle shadow-inner whitespace-nowrap shrink-0">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => setWorkspace(ws.id)}
            className={`flex items-center px-2 py-0.5 rounded-md transition-all text-[11px] font-medium whitespace-nowrap shrink-0 ${
              activeWorkspace === ws.id
                ? 'bg-dark-800 text-white shadow border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-dark-850'
            }`}
          >
            {ws.icon}
            <span className="whitespace-nowrap">{ws.label}</span>
          </button>
        ))}
      </div>

      {/* Right: Runtime Mode Indicator, GPU Accelerator, Project Info & Export CTA */}
      <div className="flex items-center space-x-2 shrink-0">
        {/* Runtime mode: an interactive toggle in development, a read-only badge in production.
            Demo mode fabricates transcripts, probe metadata and export results, so it must never
            be one click away in a shipped build. */}
        {demoModeAvailable ? (
          <button
            onClick={toggleRuntimeMode}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded-panel border text-[10px] font-mono font-semibold transition-all cursor-pointer select-none shrink-0 ${
              runtimeMode === 'live'
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/80 shadow-sm shadow-emerald-950/50'
                : 'bg-purple-950/70 border-purple-500/60 text-purple-300 hover:bg-purple-900/80 shadow-sm shadow-purple-950/50'
            }`}
            title={`Development-only toggle. Currently in ${runtimeMode.toUpperCase()} mode.`}
          >
            {runtimeMode === 'live' ? (
              <>
                <ShieldAlert className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>MODE: LIVE</span>
              </>
            ) : (
              <>
                <FlaskConical className="w-3 h-3 text-purple-400 shrink-0" />
                <span>MODE: DEMO (DEV)</span>
              </>
            )}
          </button>
        ) : (
          <div
            className="flex items-center space-x-1 px-2 py-0.5 rounded-panel border bg-emerald-950/70 border-emerald-500/60 text-emerald-300 text-[10px] font-mono font-semibold select-none shrink-0"
            title="Production builds always run in live mode. Demo mode is available in development only."
          >
            <ShieldAlert className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>MODE: LIVE</span>
          </div>
        )}

        <div className="hidden lg:flex items-center space-x-1.5 px-2 py-0.5 rounded-panel bg-dark-900 border border-subtle text-[10px] text-teal-accent font-mono shrink-0">
          <Cpu className="w-3 h-3 text-teal-accent" />
          <span>WebGPU Accel</span>
        </div>

        <button
          onClick={toggleMagneticSnapping}
          className={`flex items-center px-2 py-1 rounded-panel text-[11px] font-medium border transition-all shrink-0 ${
            magneticSnapping
              ? 'bg-indigo-950/80 border-indigo-500/80 text-indigo-300 shadow-sm shadow-indigo-900/30'
              : 'bg-dark-900 border-subtle text-neutral-400 hover:text-neutral-200'
          }`}
          title="Toggle Magnetic Snapping (S)"
        >
          <Magnet className={`w-3 h-3 mr-1 ${magneticSnapping ? 'text-indigo-400' : 'text-neutral-400'}`} />
          <span>Snap</span>
        </button>

        <div className="h-4 w-[1px] bg-neutral-800 hidden sm:block" />

        <div className="text-right hidden sm:block truncate max-w-[110px]">
          <div className="font-semibold text-neutral-200 text-[11px] leading-tight truncate">
            {metadata.name}
          </div>
          <div className="text-[9px] text-neutral-500 font-mono tabular-nums">
            {metadata.width}x{metadata.height} • {metadata.fps}fps
          </div>
        </div>

        <button
          onClick={() => setWorkspace('export')}
          className="flex items-center space-x-1.5 px-3 py-1 rounded-panel bg-gradient-to-r from-indigo-accent to-purple-600 hover:from-indigo-hover hover:to-purple-700 text-white font-medium text-[11px] shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
