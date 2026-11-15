import React, { useCallback, useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMapsLibrary,
  useMap,
} from '@vis.gl/react-google-maps';
import { Globe, MapPin, Navigation, Route as RouteIcon, Search, X } from 'lucide-react';
import { CITY_HUBS } from '../data/worldCatalog';
import type { CityHub, CityHubId, LandmarksGroundingResult, MissionItem } from '../types/game';

interface Props {
  activeCityId: CityHubId;
  mapsApiKey: string;
  onSelectCity: (cityId: CityHubId) => void;
  onCreateLandmarkMission: (title: string, mapsUri?: string) => void;
  onClose: () => void;
}

const DistrictMarkers: React.FC<{
  city: CityHub;
  onRouteToDistrict: (dest: { lat: number; lng: number; name: string }) => void;
}> = ({ city, onRouteToDistrict }) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      {city.districts.map((d, idx) => {
        const pos = {
          lat: city.lat + (d.centerZ * -0.00022),
          lng: city.lng + (d.centerX * 0.00025),
        };
        return (
          <AdvancedMarker
            key={d.id}
            ref={selectedIdx === idx ? markerRef : undefined}
            position={pos}
            title={d.name}
            onClick={() => {
              setSelectedIdx(idx);
              onRouteToDistrict({ ...pos, name: d.name });
            }}
          >
            <Pin
              background={d.accentHex}
              borderColor="#090b10"
              glyphColor="#090b10"
            />
          </AdvancedMarker>
        );
      })}
      {selectedIdx !== null && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setSelectedIdx(null)}>
          <div className="text-zinc-900 text-xs p-1">
            <div className="font-semibold">{city.districts[selectedIdx].name}</div>
            <div>{city.districts[selectedIdx].vibe}</div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

// Modern Routes API integration via useMapsLibrary('routes') - no legacy DirectionsService!
const RouteCalculatorEffect: React.FC<{
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number; name: string } | null;
  onRouteSummary: (summary: string | null) => void;
}> = ({ origin, destination, onRouteSummary }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');

  useEffect(() => {
    if (!map || !routesLib || !destination) return;
    let cancelled = false;
    interface MapPolyline {
      setMap: (m: unknown) => void;
    }
    let polylines: MapPolyline[] = [];

    (async () => {
      try {
        // Use modern Route.computeRoutes via routes library
        const RouteClass = (routesLib as unknown as {
          Route?: {
            computeRoutes: (req: unknown) => Promise<{
              routes?: Array<{
                distanceMeters?: number;
                durationMillis?: number;
                createPolylines?: () => MapPolyline[];
              }>;
            }>;
          };
        }).Route;

        if (RouteClass && typeof RouteClass.computeRoutes === 'function') {
          const res = await RouteClass.computeRoutes({
            origin,
            destination: { lat: destination.lat, lng: destination.lng },
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis'],
          });
          if (cancelled) return;
          const r = res.routes?.[0];
          if (r) {
            if (typeof r.createPolylines === 'function') {
              polylines = r.createPolylines();
              polylines.forEach((p) => p.setMap(map));
            }
            const km = r.distanceMeters ? (r.distanceMeters / 1000).toFixed(1) : '?';
            const mins = r.durationMillis ? Math.max(1, Math.round(r.durationMillis / 60000)) : '?';
            onRouteSummary(`Route to ${destination.name}: ${km} km · ~${mins} min drive`);
          }
        }
      } catch {
        if (!cancelled) {
          onRouteSummary(`Pinned waypoint: ${destination.name}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      polylines.forEach((p) => p.setMap(null));
    };
  }, [map, routesLib, origin, destination, onRouteSummary]);

  return null;
};

export const WorldAtlasPanel: React.FC<Props> = ({
  activeCityId,
  mapsApiKey,
  onSelectCity,
  onCreateLandmarkMission,
  onClose,
}) => {
  const activeCity = CITY_HUBS[activeCityId];
  const [searchQuery, setSearchQuery] = useState('');
  const [grounding, setGrounding] = useState<LandmarksGroundingResult | null>(null);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [routeTarget, setRouteTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [routeSummary, setRouteSummary] = useState<string | null>(null);

  const fetchGroundedPlaces = useCallback(async (cityId: CityHubId, q?: string) => {
    setLoadingPlaces(true);
    setPlacesError(null);
    try {
      const c = CITY_HUBS[cityId];
      const res = await fetch('/api/ai/maps-landmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityId, query: q, lat: c.lat, lng: c.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Maps grounding failed');
      setGrounding(data);
    } catch (e) {
      setPlacesError(e instanceof Error ? e.message : 'Could not load grounded locations');
    } finally {
      setLoadingPlaces(false);
    }
  }, []);

  useEffect(() => {
    fetchGroundedPlaces(activeCityId);
    setRouteTarget(null);
    setRouteSummary(null);
  }, [activeCityId, fetchGroundedPlaces]);

  return (
    <div className="fixed inset-x-4 bottom-24 top-16 z-30 mx-auto max-w-6xl rounded-xl border border-zinc-700/80 bg-[#0d111a]/95 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Global Cities & Google Maps Atlas
          </h2>
          <p className="text-xs text-zinc-400">
            Travel across international city hubs and pull real-world landmarks into live missions
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close atlas"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* City Selector Strip */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 overflow-x-auto bg-zinc-900/70">
        {(Object.keys(CITY_HUBS) as CityHubId[]).map((cid) => {
          const hub = CITY_HUBS[cid];
          const active = cid === activeCityId;
          return (
            <button
              key={cid}
              onClick={() => onSelectCity(cid)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                active
                  ? 'bg-amber-500 text-zinc-950 font-semibold'
                  : 'bg-zinc-900 text-zinc-300 border border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{hub.name}</span>
              <span className={active ? 'text-zinc-900/80' : 'text-zinc-500'}>
                {hub.country}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        {/* Left: Live Google Maps Component */}
        <div className="lg:col-span-7 relative min-h-[280px] h-full bg-zinc-950 border-b lg:border-b-0 lg:border-r border-zinc-800">
          {mapsApiKey ? (
            <APIProvider apiKey={mapsApiKey} language="en" region="US">
              <GoogleMap
                style={{ width: '100%', height: '100%' }}
                center={{ lat: activeCity.lat, lng: activeCity.lng }}
                defaultZoom={13}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                disableDefaultUI={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              >
                <DistrictMarkers
                  city={activeCity}
                  onRouteToDistrict={(dest) => setRouteTarget(dest)}
                />
                <RouteCalculatorEffect
                  origin={{ lat: activeCity.lat, lng: activeCity.lng }}
                  destination={routeTarget}
                  onRouteSummary={setRouteSummary}
                />
              </GoogleMap>
            </APIProvider>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-400 text-xs">
              <MapPin className="w-6 h-6 text-amber-400 mb-2" />
              <div>Google Maps key is loading or unavailable. Select districts below to navigate.</div>
            </div>
          )}

          {routeSummary && (
            <div className="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-lg bg-zinc-950/90 border border-zinc-700 text-xs text-zinc-100 flex items-center gap-2">
              <RouteIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{routeSummary}</span>
            </div>
          )}
        </div>

        {/* Right: Maps Grounded Real-World Landmarks */}
        <div className="lg:col-span-5 flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchGroundedPlaces(activeCityId, searchQuery);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search real spots in ${activeCity.name}...`}
                className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={loadingPlaces}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-amber-400 transition-colors flex items-center gap-1"
              >
                <Search className="w-3.5 h-3.5" />
                Scout
              </button>
            </form>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingPlaces && (
              <div className="text-xs text-zinc-400">Querying live Google Maps place data...</div>
            )}
            {placesError && (
              <div className="text-xs text-rose-400">{placesError}</div>
            )}
            {grounding && (
              <>
                {grounding.chunks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-zinc-300">
                      Grounded Google Maps Venues
                    </div>
                    {grounding.chunks.map((chunk, i) => (
                      <div
                        key={`${chunk.uri}_${i}`}
                        className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={chunk.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-amber-400 hover:underline truncate"
                          >
                            {chunk.title}
                          </a>
                          <button
                            onClick={() => {
                              onCreateLandmarkMission(chunk.title, chunk.uri);
                              onClose();
                            }}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-[11px] font-medium text-zinc-200 whitespace-nowrap transition-colors flex items-center gap-1"
                          >
                            <Navigation className="w-3 h-3" />
                            Set Mission
                          </button>
                        </div>
                        {chunk.snippet && (
                          <p className="text-[11px] text-zinc-400 line-clamp-2">{chunk.snippet}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-zinc-300 whitespace-pre-line leading-relaxed">
                  {grounding.markdown}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
