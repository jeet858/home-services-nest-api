import { Injectable } from '@nestjs/common';
import { ExternalServiceError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';

// Place search and reverse geocoding for the customer app's address form.
// Backed by Photon (OpenStreetMap). The apps only see the normalised Place shape, so the
// provider can be changed here (or pointed at a self-hosted Photon via GEO_PHOTON_URL).

export interface Place {
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  street: string;
  city: string;
  state: string;
  zip: string;
}

const BASE = () => (process.env.GEO_PHOTON_URL || 'https://photon.komoot.io').replace(/\/+$/, '');
// West, south, east, north: mainland India plus the islands.
const INDIA_BBOX = '68.1,6.5,97.5,35.7';
const TIMEOUT_MS = 4000;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

const uniq = (parts: (string | undefined | null)[]) => {
  const seen = new Set<string>();
  return parts.filter((p): p is string => {
    const v = (p ?? '').trim();
    if (!v || seen.has(v.toLowerCase())) return false;
    seen.add(v.toLowerCase());
    return true;
  });
};

function toPlace(feature: any): Place | null {
  const p = feature?.properties ?? {};
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const isCity = ['city', 'town', 'village'].includes(p.osm_value) || p.type === 'city';
  const road = uniq([p.housenumber, p.street]).join(' ');
  const city = p.city || (isCity ? p.name : '') || p.county || '';
  const area = p.locality || p.district || '';
  // What goes in the form's "Street, area or society" box.
  const street = uniq([p.name && p.name !== city ? p.name : '', road, area]).join(', ');
  const title = p.name || road || area || city || p.state || '';
  if (!title) return null;
  return {
    title,
    subtitle: uniq([road, area, city, p.state, p.postcode])
      .filter((s) => s !== title)
      .join(', '),
    lat,
    lng,
    street,
    city,
    state: p.state || '',
    zip: /^\d{6}$/.test(p.postcode ?? '') ? p.postcode : '',
  };
}

@Injectable()
export class GeoService {
  // Per warm instance; enough to absorb repeated keystrokes and popular places.
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

  private async fetchPlaces(path: string, params: Record<string, string>): Promise<Place[]> {
    const url = `${BASE()}${path}?${new URLSearchParams({ ...params, lang: 'en' })}`;
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.places;

    let body: any;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'home-services-api/1.0 (address search)', Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (error) {
      logger.warn('Place lookup failed', { path, error: (error as Error).message });
      throw new ExternalServiceError('Location search is unavailable right now. You can still place the pin on the map.', 'photon');
    }

    const places = ((body?.features as any[]) ?? []).map(toPlace).filter((p): p is Place => p !== null);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(url, { at: Date.now(), places });
    return places;
  }

  /** Places in India matching the text, nearest to (lat, lng) first when given. */
  async search(q: unknown, lat?: unknown, lng?: unknown) {
    const text = String(q ?? '')
      .trim()
      .slice(0, 120);
    if (text.length < 3) throw new ValidationError('Type at least 3 characters to search');
    const params: Record<string, string> = { q: text, limit: '8', bbox: INDIA_BBOX };
    const nearLat = Number(lat);
    const nearLng = Number(lng);
    if (lat != null && lng != null && Number.isFinite(nearLat) && Number.isFinite(nearLng) && Math.abs(nearLat) <= 90 && Math.abs(nearLng) <= 180) {
      // Rounded so nearby users share cache entries and exact positions are not sent upstream.
      params.lat = nearLat.toFixed(2);
      params.lon = nearLng.toFixed(2);
    }
    const places = await this.fetchPlaces('/api', params);
    // Photon can return the same place as a node and a way.
    const seen = new Set<string>();
    return places
      .filter((p) => {
        const key = `${p.title}|${p.subtitle}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }

  /** Address fields for a map pin, or null when nothing is mapped there. */
  async reverse(lat: unknown, lng: unknown) {
    const la = Number(lat);
    const lo = Number(lng);
    if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      throw new ValidationError('Send a valid lat and lng');
    }
    const places = await this.fetchPlaces('/reverse', { lat: la.toFixed(5), lon: lo.toFixed(5), limit: '1' });
    return places[0] ? { ...places[0], lat: la, lng: lo } : null;
  }
}
