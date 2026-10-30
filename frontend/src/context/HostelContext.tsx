import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Pool } from '../services/api';
import { previewMode } from '../services/config';
import { mockPools } from '../data/mockProducts';
import { useAuth } from './AuthContext';

// Customers choose a pool first: one shared stock serving one or more hostels ("Boys' Hostels").
// Their exact hostel is picked at checkout from that pool's hostels.

interface HostelContextValue {
  /** Pools customers can choose from, each with its active hostels. */
  pools: Pool[];
  poolsLoading: boolean;
  poolsError: string | null;
  reloadPools: () => void;
  /** The pool the customer is shopping in. Null until they choose one. */
  selectedPool: Pool | null;
  /** Explains why an earlier selection was cleared, e.g. its hostels were closed. */
  selectionNotice: string | null;
  selectPool: (pool: Pool) => void;
  /** The pool a hostel belongs to, if it's open for delivery. */
  poolOfHostel: (hostelId: string | null | undefined) => Pool | null;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
}

const STORAGE_KEY = 'minutes.pool.v1';
/** What the previous version saved: the hostel itself (and, lately, its pool). */
const LEGACY_HOSTEL_KEY = 'minutes.hostel.v1';
const HostelContext = createContext<HostelContextValue | null>(null);

type Stored = { id: string; name: string } | { legacyHostelId: string; legacyPoolId?: string; legacyName: string };

function loadSelection(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<{ id: string; name: string }>;
      if (typeof value.id === 'string' && typeof value.name === 'string') return { id: value.id, name: value.name };
    }
    const legacy = localStorage.getItem(LEGACY_HOSTEL_KEY);
    if (legacy) {
      const value = JSON.parse(legacy) as Partial<{ id: string; name: string; stockGroupId: string }>;
      if (typeof value.id === 'string') {
        return {
          legacyHostelId: value.id,
          legacyName: typeof value.name === 'string' ? value.name : '',
          ...(typeof value.stockGroupId === 'string' ? { legacyPoolId: value.stockGroupId } : {}),
        };
      }
    }
  } catch {
    /* unreadable storage: start fresh */
  }
  return null;
}

function saveSelection(pool: Pool | null) {
  try {
    if (pool) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: pool.id, name: pool.name }));
    else localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_HOSTEL_KEY);
  } catch {
    /* storage unavailable: the selection still works for this session */
  }
}

export function HostelProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolsLoaded, setPoolsLoaded] = useState(false);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsError, setPoolsError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [stored] = useState<Stored | null>(loadSelection);
  // Until pools load, a remembered pool is shown by its saved name (no hostels yet). A hostel
  // saved by the previous version stands in for its pool (a hostel's first pool shares its id),
  // so the saved cart isn't lost; it's corrected once pools load.
  const [selectedPool, setSelectedPool] = useState<Pool | null>(() =>
    !stored
      ? null
      : 'id' in stored
        ? { id: stored.id, name: stored.name, hostels: [] }
        : { id: stored.legacyPoolId ?? stored.legacyHostelId, name: stored.legacyName, hostels: [] },
  );
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPoolsLoading(true);
    setPoolsError(null);
    (previewMode ? Promise.resolve(mockPools) : api.getPools())
      .then((list) => {
        if (cancelled) return;
        setPools(list);
        setPoolsLoaded(true);
      })
      .catch((e: unknown) => !cancelled && setPoolsError(e instanceof Error ? e.message : 'Could not load where we deliver.'))
      .finally(() => !cancelled && setPoolsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const applySelection = useCallback((pool: Pool | null) => {
    setSelectedPool(pool);
    saveSelection(pool);
  }, []);

  const poolOfHostel = useCallback(
    (hostelId: string | null | undefined) => (hostelId ? pools.find((p) => p.hostels.some((h) => h.id === hostelId)) ?? null : null),
    [pools],
  );

  // Once pools load: refresh the remembered pool (name, hostels), turn a hostel saved by the
  // previous version into its pool, and drop a pool that no longer has open hostels.
  useEffect(() => {
    if (!poolsLoaded || !selectedPool) return;
    const current =
      pools.find((p) => p.id === selectedPool.id) ??
      // A hostel saved by the previous version may since have joined a shared pool.
      (stored && 'legacyHostelId' in stored ? poolOfHostel(stored.legacyHostelId) : null);
    if (!current) {
      applySelection(null);
      setSelectionNotice(`${selectedPool.name || 'Your hostel'} is no longer available. Please choose again.`);
    } else if (current !== selectedPool) {
      applySelection(current);
    }
  }, [poolsLoaded, pools, selectedPool, stored, poolOfHostel, applySelection]);

  // A signed-in customer with nothing chosen yet starts at the pool of their saved hostel.
  useEffect(() => {
    if (!poolsLoaded || selectedPool || !profile?.hostelId) return;
    const pool = poolOfHostel(profile.hostelId);
    if (pool) applySelection(pool);
  }, [poolsLoaded, selectedPool, profile?.hostelId, poolOfHostel, applySelection]);

  const selectPool = useCallback(
    (pool: Pool) => {
      applySelection(pool);
      setSelectionNotice(null);
      setPickerOpen(false);
    },
    [applySelection],
  );

  const reloadPools = useCallback(() => setTick((t) => t + 1), []);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value = useMemo<HostelContextValue>(
    () => ({
      pools,
      poolsLoading,
      poolsError,
      reloadPools,
      selectedPool,
      selectionNotice,
      selectPool,
      poolOfHostel,
      pickerOpen,
      openPicker,
      closePicker,
    }),
    [pools, poolsLoading, poolsError, reloadPools, selectedPool, selectionNotice, selectPool, poolOfHostel, pickerOpen, openPicker, closePicker],
  );

  return <HostelContext.Provider value={value}>{children}</HostelContext.Provider>;
}

export function useHostel(): HostelContextValue {
  const ctx = useContext(HostelContext);
  if (!ctx) throw new Error('useHostel must be used inside <HostelProvider>');
  return ctx;
}
