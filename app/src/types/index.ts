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

export type ThreatSignals = {
  audioScore: number;
  motionScore: number;
  heartRateScore: number;
  routineDeviationScore: number;
  nightMultiplier: number;
  manualSOS: boolean;
};

export type ThreatResult = {
  totalScore: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  shouldTrigger: boolean;
  breakdown: ThreatSignals;
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
