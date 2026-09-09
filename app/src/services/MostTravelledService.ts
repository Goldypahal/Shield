import AsyncStorage from '@react-native-async-storage/async-storage';

export type VisitedLocation = {
  name: string;
  lat: number;
  lon: number;
  visitCount: number;
  lastVisited: number;
};

const LOCATIONS_KEY = '@shield_most_travelled';

class MostTravelledService {
  async recordVisit(lat: number, lon: number, name?: string) {
    const list = await this.getLocations();
    
    // Simple proximity check (within ~100m) to group visits
    const index = list.findIndex(l => 
      Math.abs(l.lat - lat) < 0.001 && Math.abs(l.lon - lon) < 0.001
    );

    if (index !== -1) {
      list[index].visitCount += 1;
      list[index].lastVisited = Date.now();
      if (name) list[index].name = name;
    } else {
      list.push({
        name: name || `Location ${list.length + 1}`,
        lat,
        lon,
        visitCount: 1,
        lastVisited: Date.now()
      });
    }

    // Sort by visit count and keep top 10
    const sorted = list.sort((a, b) => b.visitCount - a.visitCount).slice(0, 10);
    await AsyncStorage.setItem(LOCATIONS_KEY, JSON.stringify(sorted));
  }

  async getLocations(): Promise<VisitedLocation[]> {
    const data = await AsyncStorage.getItem(LOCATIONS_KEY);
    return data ? JSON.parse(data) : [];
  }

  async getTop5(): Promise<VisitedLocation[]> {
    const list = await this.getLocations();
    return list.slice(0, 5);
  }
}

export default new MostTravelledService();
