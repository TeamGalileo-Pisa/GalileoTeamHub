import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Area {
  id: string;
  name: string;
  description: string;
  slug: string;
}

export function AreasPage() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAreas();
  }, []);

  async function fetchAreas() {
    const { data } = await supabase.from('areas').select('*').order('name');
    if (data) setAreas(data);
  }

  const copyLink = (slug: string, id: string) => {
    const link = `${window.location.origin}/prenota/${slug}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Gestione Aree e Calendari Unici</h1>

      <div className="grid grid-cols-1 gap-4">
        {areas.map((area) => {
          const publicUrl = `${window.location.origin}/prenota/${area.slug}`;
          return (
            <div key={area.id} className="p-4 bg-white border rounded-lg shadow-sm flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{area.name}</h3>
                <p className="text-sm text-gray-500">{area.description}</p>
                <div className="mt-2 text-xs text-indigo-600 font-mono">
                  Link pubblico: <a href={publicUrl} target="_blank" rel="noreferrer" className="underline">{publicUrl}</a>
                </div>
              </div>
              <button
                onClick={() => copyLink(area.slug, area.id)}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium transition-colors"
              >
                {copiedId === area.id ? 'Copiato! ✓' : 'Copia Link'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}