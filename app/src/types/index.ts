export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
};

export type UserProfile = {
  uid: string;
  phone: string;
  name: string;
  photoUrl?: string;
  emergencyContacts: EmergencyContact[];
  sensitivityMode: 'NORMAL' | 'HIGH_ALERT';
  voiceKeyword?: string;
  fakeCallerName?: string;
  fakeCallerPhoto?: string;
  routineEnabled?: boolean;
};

export type DistressState = 'MONITORING' | 'SUSPECTED' | 'PRE_ALERT' | 'ACTIVE' | 'CANCELLED';

export type SRSThreatSignals = {
  audioScore: number;          // 0-100 (from on-device audio model)
  motionScore: number;         // 0-100 (from fall/struggle detection)
  contextScore: number;        // 0-100 (from route risk & environmental context)
  isNight?: boolean;           // night multiplier M_night = 1.2
  segmentSafetyScore?: number; // segment safety score (threshold drops to 60 when < 40)
  manualSOS?: boolean;         // +40 manual SOS boost
};

export type ThreatSignals = {
  audioScore: number;
  motionScore: number;
  heartRateScore?: number;
  routineDeviationScore?: number;
  contextScore?: number;
  nightMultiplier?: number;
  manualSOS?: boolean;
};

export type ThreatResult = {
  totalScore: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  shouldTrigger: boolean;
  threshold: number;
  state?: DistressState;
  breakdown: any;
};

export type IncidentLog = {
  id?: string;
  userId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  threatScore: number;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  audioUrl?: string;
  status: 'PENDING' | 'SENT' | 'CANCELLED';
  delivery?: {
    sms?: boolean;
    call?: boolean;
  };
};

export type IncidentHistoryItem = {
  incident_id: string;
  alert_id: string;
  threat_level: string;
  explainable_reason: string;
  lat: number;
  lon: number;
  state: string;
  created_at?: string | null;
};
