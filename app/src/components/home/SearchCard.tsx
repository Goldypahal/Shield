import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKENS } from '../../theme/tokens';
import { useJourneyStore } from '../../store/useJourneyStore';
import { Place } from '../../data/mockRoutes';
import { searchRealPlaces, getAccurateUserLocation } from '../../services/locationService';

interface SearchCardProps {
  onRecenter?: () => void;
}

const POPULAR_DESTINATIONS: Place[] = [
  { label: 'Chandigarh University, Mohali (Block D4 & Campus)', lat: 30.7685, lng: 76.5755 },
  { label: 'Elante Mall, Industrial Area Phase 1', lat: 30.7055, lng: 76.8013 },
  { label: 'Sector 17 Plaza, Chandigarh', lat: 30.7398, lng: 76.7827 },
  { label: 'ISBT Sector 43, Chandigarh', lat: 30.7188, lng: 76.7412 },
  { label: 'Sohana Gurdwara, Sector 78, Mohali', lat: 30.6865, lng: 76.7210 },
  { label: 'VR Punjab Mall, Kharar Highway', lat: 30.7482, lng: 76.6543 },
];

export default function SearchCard({ onRecenter }: SearchCardProps) {
  const {
    origin,
    destination,
    stops,
    swapPlaces,
    setOrigin,
    setDestination,
    removeStop,
    detectAndSetCurrentLocation,
  } = useJourneyStore();

  const [searchTarget, setSearchTarget] = useState<'origin' | 'destination' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Place[]>(POPULAR_DESTINATIONS);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [isSwapped, setIsSwapped] = useState(false);

  const handleSwap = () => {
    Animated.timing(rotateAnim, {
      toValue: isSwapped ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
    setIsSwapped(!isSwapped);
    swapPlaces();
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const loc = await detectAndSetCurrentLocation();
      if (loc && searchTarget === 'origin') {
        await setOrigin(loc);
      } else if (loc && searchTarget === 'destination') {
        await setDestination(loc);
      }
    } catch (e) {
      console.warn('Location detection failed', e);
    } finally {
      setIsLocating(false);
      setSearchTarget(null);
      setSearchQuery('');
    }
  };

  const handleQueryChange = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length >= 2) {
      setIsSearching(true);
      try {
        const places = await searchRealPlaces(text);
        if (places.length > 0) {
          setSearchResults(
            places.map((p) => ({
              label: p.label,
              lat: p.latitude,
              lng: p.longitude,
            }))
          );
        } else {
          setSearchResults(
            POPULAR_DESTINATIONS.filter((p) =>
              p.label.toLowerCase().includes(text.toLowerCase())
            )
          );
        }
      } catch (_) {
        setSearchResults(
          POPULAR_DESTINATIONS.filter((p) =>
            p.label.toLowerCase().includes(text.toLowerCase())
          )
        );
      } finally {
        setIsSearching(false);
      }
    } else {
      setSearchResults(POPULAR_DESTINATIONS);
    }
  };

  const handleSelectPlace = (place: Place) => {
    if (searchTarget === 'origin') {
      setOrigin(place);
    } else if (searchTarget === 'destination') {
      setDestination(place);
    }
    setSearchTarget(null);
    setSearchQuery('');
  };

  return (
    <View style={styles.cardContainer}>
      <View style={styles.card}>
        {/* Left Google Maps Style Origin & Destination Form */}
        <View style={styles.inputsColumn}>
          {/* 1. Origin Row (Google Maps blue origin dot) */}
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => {
              setSearchTarget('origin');
              setSearchQuery('');
              setSearchResults(POPULAR_DESTINATIONS);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.originIconCircle}>
              <View style={styles.originIconInner} />
            </View>
            <Text style={styles.originText} numberOfLines={1}>
              {origin.label || 'Your location'}
            </Text>
            <TouchableOpacity
              onPress={onRecenter}
              style={styles.recenterIconBtn}
              accessibilityLabel="Re-detect GPS location"
            >
              <Ionicons name="navigate" size={16} color="#FF5A1F" />
            </TouchableOpacity>
          </TouchableOpacity>

          {/* Vertical Connecting Dots (Google Maps signature style) */}
          <View style={styles.verticalConnector}>
            <View style={styles.connectorDot} />
            <View style={styles.connectorDot} />
            <View style={styles.connectorDot} />
          </View>

          {/* Optional Intermediate Stops */}
          {stops.map((stop, index) => (
            <View key={`stop-${index}`} style={styles.stopRow}>
              <View style={styles.stopDot} />
              <Text style={styles.stopText} numberOfLines={1}>
                {stop.label}
              </Text>
              <TouchableOpacity
                onPress={() => removeStop(index)}
                style={styles.removeStopBtn}
                accessibilityLabel="Remove stop"
              >
                <Ionicons name="close-circle" size={16} color={TOKENS.colors.ink[400]} />
              </TouchableOpacity>
            </View>
          ))}

          {/* 2. Destination Row (Google Maps red pin) */}
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => {
              setSearchTarget('destination');
              setSearchQuery('');
              setSearchResults(POPULAR_DESTINATIONS);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.destIconContainer}>
              <Ionicons name="location" size={20} color="#EA4335" />
            </View>
            <Text
              style={[
                styles.destText,
                {
                  color: destination ? TOKENS.colors.ink[900] : '#9AA0A6',
                  fontWeight: destination ? '600' : '400',
                },
              ]}
              numberOfLines={1}
            >
              {destination ? destination.label : 'Choose destination...'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Right Swap Button ⇅ (Google Maps style) */}
        <TouchableOpacity
          style={styles.swapButton}
          onPress={handleSwap}
          accessibilityRole="button"
          accessibilityLabel="Swap origin and destination"
          activeOpacity={0.7}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="swap-vertical" size={20} color="#5F6368" />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Place Search Sheet Modal with "Use Current Location" option */}
      <Modal
        visible={searchTarget !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSearchTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sheetContainer}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {searchTarget === 'origin' ? 'Choose starting point' : 'Choose destination'}
              </Text>
              <TouchableOpacity onPress={() => setSearchTarget(null)}>
                <Ionicons name="close" size={22} color={TOKENS.colors.ink[600]} />
              </TouchableOpacity>
            </View>

            {/* Google Maps Style: Use Current Location Button */}
            <TouchableOpacity
              style={styles.useCurrentLocationBtn}
              onPress={handleUseCurrentLocation}
              disabled={isLocating}
              activeOpacity={0.7}
            >
              <View style={styles.currentLocIconBox}>
                {isLocating ? (
                  <ActivityIndicator size="small" color="#FF5A1F" />
                ) : (
                  <Ionicons name="locate" size={20} color="#FF5A1F" />
                )}
              </View>
              <View style={styles.currentLocTextCol}>
                <Text style={styles.currentLocTitle}>Your current location</Text>
                <Text style={styles.currentLocSubtitle}>Use accurate device GPS coordinates</Text>
              </View>
            </TouchableOpacity>

            {/* Google Maps Search Bar */}
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color="#5F6368" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search place, street or university block..."
                placeholderTextColor="#9AA0A6"
                value={searchQuery}
                onChangeText={handleQueryChange}
                autoFocus
              />
              {isSearching ? (
                <ActivityIndicator size="small" color={TOKENS.colors.brand.orange} />
              ) : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => handleQueryChange('')}>
                  <Ionicons name="close-circle" size={18} color="#5F6368" />
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.suggestionsHeading}>
              {searchQuery.length >= 2 ? 'Search Results' : 'Suggested Destinations'}
            </Text>

            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => `${item.label}-${index}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.placeItem}
                  onPress={() => handleSelectPlace(item)}
                >
                  <View style={styles.placePinBox}>
                    <Ionicons name="location-sharp" size={18} color="#5F6368" />
                  </View>
                  <View style={styles.placeInfoCol}>
                    <Text style={styles.placeItemTitle} numberOfLines={1}>
                      {item.label.split(',')[0]}
                    </Text>
                    <Text style={styles.placeItemSubtitle} numberOfLines={1}>
                      {item.label.split(',').slice(1).join(',').trim() || 'Chandigarh Capital Region'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    paddingHorizontal: 16,
    marginTop: 6,
    zIndex: 5,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#1F2937',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  inputsColumn: {
    flex: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  originIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFF0E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  originIconInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FF5A1F',
  },
  originText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#202124',
    flex: 1,
  },
  recenterIconBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: '#F1F3F4',
    marginLeft: 6,
  },
  verticalConnector: {
    marginLeft: 9,
    paddingVertical: 1,
    gap: 3,
  },
  connectorDot: {
    width: 2.5,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: '#BDC1C6',
  },
  destIconContainer: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  destText: {
    fontSize: 14,
    flex: 1,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    marginLeft: 5,
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TOKENS.colors.moderate.amber,
    marginRight: 14,
  },
  stopText: {
    fontSize: 13,
    color: TOKENS.colors.ink[600],
    flex: 1,
  },
  removeStopBtn: {
    padding: 4,
  },
  swapButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#DADCE0',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: '80%',
    minHeight: 420,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DADCE0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#202124',
  },
  useCurrentLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: '#FFF0E8',
    borderRadius: 12,
    marginBottom: 14,
  },
  currentLocIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocTextCol: {
    marginLeft: 12,
  },
  currentLocTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FF5A1F',
  },
  currentLocSubtitle: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F3F4',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#202124',
  },
  suggestionsHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#70757A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginVertical: 8,
    marginLeft: 4,
  },
  placeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EAED',
  },
  placePinBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F3F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeInfoCol: {
    marginLeft: 12,
    flex: 1,
  },
  placeItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#202124',
  },
  placeItemSubtitle: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 2,
  },
});
