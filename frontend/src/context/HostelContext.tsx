import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Hostel } from '../services/api';
import { previewMode } from '../services/config';
import { mockHostels } from '../data/mockProducts';
import { useAuth } from './AuthContext';

interface HostelContextValue {
  /** Active hostels customers can choose from. */
  hostels: Hostel[];
  hostelsLoading: boolean;
  hostelsError: string | null;
  reloadHostels: () => void;
  /** The store hostel the customer is shopping at. Null until they choose one. */
  selectedHostel: Hostel | null;
  /** Explains why an earlier selection was cleared, e.g. the hostel was deactivated. */
  selectionNotice: string | null;
  selectHostel: (hostel: Hostel) => void;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
}

const STORAGE_KEY = 'minutes.hostel.v1';
const HostelContext = createContext<HostelContextValue | null>(null);

function loadSelection(): Hostel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Hostel>;
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
    return { id: value.id, name: value.name, ...(typeof value.stockGroupId === 'string' ? { stockGroupId: value.stockGroupId } : {}) };
  } catch {
    return null;
  }
}

function saveSelection(hostel: Hostel | null) {
  try {
    if (hostel) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: hostel.id, name: hostel.name, stockGroupId: hostel.stockGroupId }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the selection still works for this session */
  }
}

export function HostelProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [hostelsLoaded, setHostelsLoaded] = useState(false);
  const [hostelsLoading, setHostelsLoading] = useState(true);
  const [hostelsError, setHostelsError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [selectedHostel, setSelectedHostel] = useState<Hostel | null>(loadSelection);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHostelsLoading(true);
    setHostelsError(null);
    (previewMode ? Promise.resolve(mockHostels) : api.getHostels())
      .then((list) => {
        if (cancelled) return;
        setHostels(list);
        setHostelsLoaded(true);
      })
      .catch((e: unknown) => !cancelled && setHostelsError(e instanceof Error ? e.message : 'Could not load hostels.'))
      .finally(() => !cancelled && setHostelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const applySelection = useCallback((hostel: Hostel | null) => {
    setSelectedHostel(hostel);
    saveSelection(hostel);
  }, []);

  // Drop a stored hostel that is no longer active, and keep its name and stock group current.
  useEffect(() => {
    if (!hostelsLoaded || !selectedHostel) return;
    const current = hostels.find((h) => h.id === selectedHostel.id);
    if (!current) {
      applySelection(null);
      setSelectionNotice(`${selectedHostel.name} is no longer available. Please choose another hostel.`);
    } else if (current.name !== selectedHostel.name || current.stockGroupId !== selectedHostel.stockGroupId) {
      applySelection({ id: current.id, name: current.name, stockGroupId: current.stockGroupId });
    }
  }, [hostelsLoaded, hostels, selectedHostel, applySelection]);

  // A signed-in customer with no store hostel yet starts at their saved delivery hostel.
  useEffect(() => {
    if (!hostelsLoaded || selectedHostel || !profile?.hostelId) return;
    const saved = hostels.find((h) => h.id === profile.hostelId);
    if (saved) applySelection(saved);
  }, [hostelsLoaded, hostels, selectedHostel, profile?.hostelId, applySelection]);

  const selectHostel = useCallback(
    (hostel: Hostel) => {
      applySelection({ id: hostel.id, name: hostel.name, stockGroupId: hostel.stockGroupId });
      setSelectionNotice(null);
      setPickerOpen(false);
    },
    [applySelection],
  );

  const reloadHostels = useCallback(() => setTick((t) => t + 1), []);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value = useMemo<HostelContextValue>(
    () => ({
      hostels,
      hostelsLoading,
      hostelsError,
      reloadHostels,
      selectedHostel,
      selectionNotice,
      selectHostel,
      pickerOpen,
      openPicker,
      closePicker,
    }),
    [hostels, hostelsLoading, hostelsError, reloadHostels, selectedHostel, selectionNotice, selectHostel, pickerOpen, openPicker, closePicker],
  );

  return <HostelContext.Provider value={value}>{children}</HostelContext.Provider>;
}

export function useHostel(): HostelContextValue {
  const ctx = useContext(HostelContext);
  if (!ctx) throw new Error('useHostel must be used inside <HostelProvider>');
  return ctx;
}
