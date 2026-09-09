import { BACKEND_URL } from '../config/env';
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

class IssueReportingService {
  private readonly API_URL = `${BACKEND_URL}/api/v1/issues`;

  async getNearbyIssues(lat: number, lon: number): Promise<ReportedIssue[]> {
    try {
      const client = await AuthService.getAuthenticatedClient();
      const response = await client.get(this.API_URL, {
        params: { lat, lon, radius_km: 5 }
      });
      return response.data.issues;
    } catch {
      // Mock data for demo/fallback
      return [
        {
          id: '1',
          type: 'UNSAFE_ZONE',
          lat: lat + 0.005,
          lon: lon + 0.005,
          description: 'Recurring mobile snatching reported at this junction.',
          preventionTip: 'Keep your phone inside your bag and avoid wearing expensive jewelry here.',
          severity: 'HIGH',
          timestamp: Date.now() - 3600000
        },
        {
          id: '2',
          type: 'HARASSMENT',
          lat: lat - 0.003,
          lon: lon + 0.008,
          description: 'High number of harassment cases after 9 PM.',
          preventionTip: 'Try to walk in groups or stay on the main lit road.',
          severity: 'MEDIUM',
          timestamp: Date.now() - 86400000
        }
      ];
    }
  }

  getPreventionTipForType(type: string): string {
    const tips: Record<string, string> = {
      'CRIME': 'Stay in well-lit areas and keep your emergency contacts on speed dial.',
      'HARASSMENT': 'Ignore provocations, move to a crowded place, and activate SOS if followed.',
      'THEFT': 'Keep belongings secure and be wary of crowded public transport.',
      'UNSAFE_ZONE': 'Avoid this area after sunset and keep the SHIELD app active in the foreground.',
      'ROBBERY': 'Keep a dummy wallet and never resist armed confrontatons; focus on safety and alert authorities later.'
    };
    return tips[type] || 'Stay alert and notify your guardians of your location.';
  }
}

export default new IssueReportingService();
