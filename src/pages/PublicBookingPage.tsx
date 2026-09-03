import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAreaBySlug, getAreaPublicCalendar, AreaSlot, AreaInfo } from '../lib/data';
import { supabase } from '../lib/supabase';

export function PublicBookingPage() {
  const { areaSlug } = useParams<{ areaSlug: string }>();

  const [area, setArea] = useState<AreaInfo | null>(null);
  const [slots, setSlots] = useState<AreaSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AreaSlot | null>(null);

  // Form di prenotazione
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!areaSlug) return;

    async function loadData() {
      setLoading(true);
      const areaData = await getAreaBySlug(areaSlug!);
      if (areaData) {
        setArea(areaData);
        const calendarSlots = await getAreaPublicCalendar(areaSlug!);
        setSlots(calendarSlots);

        // Seleziona di default la prima data disponibile
        if (calendarSlots.length > 0) {
          setSelectedDate(calendarSlots[0].session_date);
        }
      }
      setLoading(false);
    }

    loadData();
  }, [areaSlug]);

  // Aggrega le date disponibili
  const availableDates = Array.from(new Set(slots.map((s) => s.session_date))).sort();

  // Filtra gli slot per la data selezionata
  const slotsForSelectedDate = slots.filter((s) => s.session_date === selectedDate);

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('bookings').insert({
        session_id: selectedSlot.slot_id,
        first_name: firstName,
        last_name: lastName,
        email: email,
        notes: notes,
        status: 'confirmed',
      });

      if (error) throw error;

      setSuccess(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Errore durante la prenotazione. Riprova.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Caricamento calendario in corso...</div>;
  }

  if (!area) {
    return (
      <div className="p-8 text-center text-red-600">
        <h2 className="text-xl font-bold">Area non trovata</h2>
        <p className="mt-2 text-gray-500">Verifica che l'indirizzo del calendario sia corretto.</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-green-50 border border-green-200 rounded-lg text-center">
        <h2 className="text-2xl font-bold text-green-800">Prenotazione Confermata!</h2>
        <p className="mt-2 text-green-700">
          Hai prenotato con successo per il giorno <strong>{selectedSlot?.session_date}</strong> alle ore{' '}
          <strong>{selectedSlot?.start_time.slice(0, 5)}</strong>.
        </p>
        <p className="mt-4 text-sm text-gray-600">Riceverai una mail di conferma all'indirizzo {email}.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Intestazione Area */}
      <div className="mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold text-gray-900">{area.name}</h1>
        {area.description && <p className="mt-2 text-gray-600">{area.description}</p>}
      </div>

      {availableDates.length === 0 ? (
        <div className="p-6 bg-yellow-50 text-yellow-800 rounded-md">
          Al momento non ci sono date disponibili per quest'area.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Selettore Date */}
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-700 mb-3">1. Seleziona una data</h3>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {availableDates.map((date) => (
                <button
                  key={date}
                  onClick={() => {
                    setSelectedDate(date);
                    setSelectedSlot(null);
                  }}
                  className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                    selectedDate === date
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {new Date(date).toLocaleDateString('it-IT', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </button>
              ))}
            </div>
          </div>

          {/* Selettore Orari disponibili */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">2. Seleziona un orario</h3>
            {slotsForSelectedDate.length === 0 ? (
              <p className="text-sm text-gray-500">Seleziona una data per vedere gli orari.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {slotsForSelectedDate.map((slot) => (
                  <button
                    key={slot.slot_id}
                    onClick={() => setSelectedSlot(slot)}
                    className={`p-3 rounded-md border text-left transition-all ${
                      selectedSlot?.slot_id === slot.slot_id
                        ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-600'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">
                      {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Disponibilità: {slot.available_capacity} posti
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Modulo Dati Utente */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">3. Inserisci i tuoi dati</h3>
            {selectedSlot ? (
              <form onSubmit={handleBooking} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Nome</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Cognome</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Note (opzionale)</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full mt-1 p-2 border rounded-md text-sm"
                  />
                </div>

                {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-indigo-600 text-white py-2 rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Conferma in corso...' : 'Conferma Prenotazione'}
                </button>
              </form>
            ) : (
              <p className="text-sm text-gray-400">Seleziona prima un orario disponibile per procedere.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}