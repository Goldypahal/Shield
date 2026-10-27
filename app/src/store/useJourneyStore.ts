import { create } from 'zustand';
import { Mode, RouteId, Place, RouteItem, INITIAL_ORIGIN } from '../data/mockRoutes';
import { getAccurateRoadRoutes } from '../services/routesApi';
import { getAccurateUserLocation } from '../services/locationService';

export type MapType = 'satellite' | 'default' | 'terrain';

export interface JourneyStore {
  mode: Mode;
  origin: Place;
  destination: Place | null;
  stops: Place[];
  routes: Record<RouteId, RouteItem> | null;
  selectedRoute: RouteId;
  sos: 'idle' | 'holding' | 'countdown' | 'sent';
  unreadNotifications: number;
  isLoading: boolean;
  transitUnavailable: boolean;
  mapType: MapType;
  activeLayers: {
    traffic: boolean;
    streetlights: boolean;
    incidents: boolean;
  };
  isJourneyActive: boolean;
  journeyStartTime: number | null;
  currentStepIndex: number;
  isVoiceMuted: boolean;
  lastCheckInTimestamp: number | null;

  // Actions
  detectAndSetCurrentLocation: () => Promise<Place | null>;
  setMode: (mode: Mode) => Promise<void>;
  swapPlaces: () => Promise<void>;
  selectRoute: (routeId: RouteId) => void;
  setOrigin: (origin: Place) => Promise<void>;
  setDestination: (destination: Place | null) => Promise<void>;
  addStop: (stop: Place) => void;
  removeStop: (index: number) => void;
  setSosState: (sos: 'idle' | 'holding' | 'countdown' | 'sent') => void;
  markNotificationsRead: () => void;
  setMapType: (type: MapType) => void;
  toggleLayer: (layer: 'traffic' | 'streetlights' | 'incidents') => void;
  startJourney: () => void;
  endJourney: () => void;
  advanceStep: () => void;
  prevStep: () => void;
  toggleVoiceMute: () => void;
  sendCheckIn: () => void;
  reroute: () => void;
}

export const useJourneyStore = create<JourneyStore>((set, get) => ({
  mode: 'walk',
  origin: INITIAL_ORIGIN,
  destination: null,
  stops: [],
  routes: null,
  selectedRoute: 'safer',
  sos: 'idle',
  unreadNotifications: 2,
  isLoading: false,
  transitUnavailable: false,
  mapType: 'satellite',
  activeLayers: {
    traffic: false,
    streetlights: false,
    incidents: false,
  },
  isJourneyActive: false,
  journeyStartTime: null,
  currentStepIndex: 0,
  isVoiceMuted: false,
  lastCheckInTimestamp: null,

  setMapType: (mapType: MapType) => {
    set({ mapType });
  },

  advanceStep: () => {
    const { routes, selectedRoute, currentStepIndex } = get();
    const steps = routes?.[selectedRoute]?.steps || [];
    if (currentStepIndex < steps.length - 1) {
      set({ currentStepIndex: currentStepIndex + 1 });
    }
  },

  prevStep: () => {
    const { currentStepIndex } = get();
    if (currentStepIndex > 0) {
      set({ currentStepIndex: currentStepIndex - 1 });
    }
  },

  toggleVoiceMute: () => {
    set((state) => ({ isVoiceMuted: !state.isVoiceMuted }));
  },

  sendCheckIn: () => {
    set({ lastCheckInTimestamp: Date.now() });
  },

  reroute: () => {
    const { selectedRoute } = get();
    const nextRoute = selectedRoute === 'safer' ? 'moderate' : selectedRoute === 'moderate' ? 'risk' : 'safer';
    set({ selectedRoute: nextRoute, currentStepIndex: 0 });
  },

  detectAndSetCurrentLocation: async () => {
    try {
      const loc = await getAccurateUserLocation();
      const origin: Place = {
        label: loc.label,
        lat: loc.latitude,
        lng: loc.longitude,
      };
      set({ origin });

      const dest = get().destination;
      if (dest) {
        if (get().mode === 'transit') {
          set({ transitUnavailable: true, routes: null });
        } else {
          set({ isLoading: true });
          const routes = await getAccurateRoadRoutes(origin, dest, get().mode);
          set({ routes, isLoading: false, transitUnavailable: false });
        }
      }
      return origin;
    } catch (e) {
      console.warn('detectAndSetCurrentLocation error:', e);
      return null;
    }
  },

  startJourney: () => {
    set({ isJourneyActive: true, journeyStartTime: Date.now(), currentStepIndex: 0 });
  },

  endJourney: () => {
    set({ isJourneyActive: false, journeyStartTime: null, currentStepIndex: 0 });
  },

  setMode: async (mode: Mode) => {
    set({ mode });
    const { origin, destination } = get();

    // Transit check: no direct transit line between hostel and campus
    if (mode === 'transit') {
      set({ transitUnavailable: true, routes: null, isLoading: false });
      return;
    }

    set({ transitUnavailable: false });
    if (destination) {
      set({ isLoading: true });
      try {
        const routes = await getAccurateRoadRoutes(origin, destination, mode);
        set({ routes, isLoading: false });
      } catch (_) {
        set({ isLoading: false });
      }
    }
  },

  swapPlaces: async () => {
    const { origin, destination, mode } = get();
    if (!destination) return;
    const newOrigin = destination;
    const newDest = origin;
    set({
      origin: newOrigin,
      destination: newDest,
    });
    if (mode === 'transit') {
      set({ transitUnavailable: true, routes: null });
      return;
    }
    set({ isLoading: true });
    try {
      const routes = await getAccurateRoadRoutes(newOrigin, newDest, mode);
      set({ routes, isLoading: false });
    } catch (_) {
      set({ isLoading: false });
    }
  },

  selectRoute: (routeId: RouteId) => {
    set({ selectedRoute: routeId });
  },

  setOrigin: async (origin: Place) => {
    set({ origin });
    const dest = get().destination;
    if (dest) {
      if (get().mode === 'transit') {
        set({ transitUnavailable: true, routes: null });
        return;
      }
      set({ isLoading: true });
      const routes = await getAccurateRoadRoutes(origin, dest, get().mode);
      set({ routes, isLoading: false });
    }
  },

  setDestination: async (destination: Place | null) => {
    set({ destination });
    if (destination) {
      if (get().mode === 'transit') {
        set({ transitUnavailable: true, routes: null });
        return;
      }
      set({ isLoading: true, transitUnavailable: false });
      const routes = await getAccurateRoadRoutes(get().origin, destination, get().mode);
      set({ routes, isLoading: false });
    } else {
      set({ routes: null, transitUnavailable: false });
    }
  },

  addStop: (stop: Place) => {
    const stops = get().stops;
    if (stops.length < 3) {
      set({ stops: [...stops, stop] });
    }
  },

  removeStop: (index: number) => {
    const stops = get().stops.filter((_, i) => i !== index);
    set({ stops });
  },

  setSosState: (sos) => {
    set({ sos });
  },

  markNotificationsRead: () => {
    set({ unreadNotifications: 0 });
  },

  toggleLayer: (layer) => {
    set((state) => ({
      activeLayers: {
        ...state.activeLayers,
        [layer]: !state.activeLayers[layer],
      },
    }));
  },
}));
