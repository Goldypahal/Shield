import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from './src/screens/HomeScreen';
import EmergencySOS from './src/screens/EmergencySOS';
import GuardianDashboard from './src/screens/GuardianDashboard';
import SafeMapScreen from './src/screens/SafeMapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import NotificationService from './src/services/notificationService';

type RootTabParamList = {
  Home: undefined;
  SOS: undefined;
  Map: undefined;
  Guardian: undefined;
  Setup: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function App() {
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    checkSetup();
    NotificationService.registerForPushNotifications().catch((error) => {
      console.warn('Initial push registration skipped', error);
    });
  }, []);

  const checkSetup = async () => {
    const complete = await AsyncStorage.getItem('@shield_setup_complete');
    setIsSetupComplete(complete === 'true');
  };

  if (isSetupComplete === null) return null; // Wait for storage

  if (!isSetupComplete) {
    return <OnboardingScreen onComplete={() => setIsSetupComplete(true)} />;
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        id="root-tabs"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: { 
            backgroundColor: '#121212', 
            borderTopWidth: 1, 
            borderTopColor: '#222',
            height: 65,
            paddingBottom: 10
          },
          tabBarActiveTintColor: '#FF9800',
          tabBarInactiveTintColor: '#555',
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: keyof typeof Ionicons.glyphMap = 'help-circle';

            if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
            else if (route.name === 'SOS') iconName = focused ? 'shield-checkmark' : 'shield-outline';
            else if (route.name === 'Map') iconName = focused ? 'navigate' : 'navigate-outline';
            else if (route.name === 'Guardian') iconName = focused ? 'eye' : 'eye-outline';
            else if (route.name === 'Setup') iconName = focused ? 'settings' : 'settings-outline';

            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="SOS" component={EmergencySOS} />
        <Tab.Screen name="Map" component={SafeMapScreen} />
        <Tab.Screen name="Guardian" component={GuardianDashboard} />
        <Tab.Screen name="Setup" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
