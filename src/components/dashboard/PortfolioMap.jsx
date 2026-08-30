import React from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

function coord(p) {
  const lat = p.latitude ?? p.lat;
  const lng = p.longitude ?? p.lng;
  if (lat == null || lng == null) return null;
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return [la, lo];
}

export default function PortfolioMap({ properties = [] }) {
  const positioned = properties.map((p) => ({ p, c: coord(p) })).filter((x) => x.c);
  if (positioned.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-base font-semibold">Carte du patrimoine</h3>
        </div>
        <div className="h-48 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
          <MapPin className="w-8 h-8 opacity-40" />
          <p>Renseignez une adresse géolocalisée sur vos biens pour les voir sur la carte.</p>
        </div>
      </div>
    );
  }
  const center = positioned.reduce((s, x) => [s[0] + x.c[0], s[1] + x.c[1]], [0, 0])
    .map((v) => v / positioned.length);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">Carte du patrimoine</h3>
        <span className="text-xs text-muted-foreground ml-auto">{positioned.length} bien(s) localisé(s)</span>
      </div>
      <MapContainer center={center} zoom={6} style={{ width: '100%', height: 260 }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positioned.map(({ p, c }) => (
          <CircleMarker key={p.id} center={c} radius={8} pathOptions={{ color: 'hsl(220 60% 25%)', fillColor: 'hsl(220 60% 25%)', fillOpacity: 0.7 }}>
            <Tooltip direction="top">{p.name || 'Bien'}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}