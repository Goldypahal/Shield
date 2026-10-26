import AuthService from './authService';

export type ReportedIssue = {
  id: string;
  type: 'CRIME' | 'HARASSMENT' | 'THEFT' | 'ROBBERY' | 'UNSAFE_ZONE';
  lat: number;
  lon: number;
  description: string;
  preventionTip: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  timestamp: number;
};

type Hazard = {
  id: string;
  lat: number;
  lon: number;
  category: string;
  description?: string | null;
  ts?: string;
};

const CATEGORY_MAP: Record<string, { type: ReportedIssue['type']; severity: ReportedIssue['severity'] }> = {
  harassment_spot: { type: 'HARASSMENT', severity: 'HIGH' },
  dark_alley: { type: 'UNSAFE_ZONE', severity: 'MEDIUM' },
  unsafe_zone: { type: 'UNSAFE_ZONE', severity: 'MEDIUM' },
  broken_light: { type: 'UNSAFE_ZONE', severity: 'LOW' },
  blocked_path: { type: 'UNSAFE_ZONE', severity: 'LOW' },
  other: { type: 'UNSAFE_ZONE', severity: 'LOW' }
};

class IssueReportingService {
  /**
   * Community hazard reports near a point, from GET /api/v1/hazards.
   * On failure this returns an empty list: a safety app must never show
   * invented incidents as if they were real reports.
   */
  async getNearbyIssues(lat: number, lon: number): Promise<ReportedIssue[]> {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const response = await client.get<{ hazards: Hazard[] }>('/api/v1/hazards', {
        params: { lat, lon, radius_km: 5 }
      });
      return (response.data.hazards || []).map((h) => {
        const mapped = CATEGORY_MAP[h.category] ?? CATEGORY_MAP.other;
        return {
          id: h.id,
          type: mapped.type,
          severity: mapped.severity,
          lat: h.lat,
          lon: h.lon,
          description: h.description || h.category.replace(/_/g, ' '),
          preventionTip: this.getPreventionTipForType(mapped.type),
          timestamp: h.ts ? Date.parse(h.ts) : Date.now()
        };
      });
    } catch (error) {
      console.warn('Hazard reports unavailable', error);
      return [];
    }
  }

  getPreventionTipForType(type: string): string {
    const tips: Record<string, string> = {
      'CRIME': 'Stay in well-lit areas and keep your emergency contacts on speed dial.',
      'HARASSMENT': 'Ignore provocations, move to a crowded place, and activate SOS if followed.',
      'THEFT': 'Keep belongings secure and be wary of crowded public transport.',
      'UNSAFE_ZONE': 'Avoid this area after sunset and keep the SHIELD app active in the foreground.',
      'ROBBERY': 'Keep a dummy wallet and never resist armed confrontations; focus on safety and alert authorities later.'
    };
    return tips[type] || 'Stay alert and notify your guardians of your location.';
  }
}

export default new IssueReportingService();
