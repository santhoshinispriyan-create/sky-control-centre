import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plane, Fuel, MapPin, Cloud, AlertTriangle, CheckCircle, RefreshCw, UserPlus, Sparkles, Send, Mic, MicOff, Search, Map as MapIcon, Crosshair, Navigation, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { GoogleMap, useJsApiLoader, Marker, Circle, InfoWindow, Polyline } from '@react-google-maps/api';

const MAP_CENTER = { lat: 37.6213, lng: -122.3790 }; // SFO
const AIRPORT_COORDS: Record<string, { lat: number, lng: number }> = {
  "PRIMARY": { lat: 37.6213, lng: -122.3790 },
  "ALT-1": { lat: 37.7126, lng: -122.2132 }, // OAK
  "ALT-2": { lat: 37.3639, lng: -121.9289 }, // SJC
};

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '1rem',
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  styles: [
    { elementType: "geometry", stylers: [{ color: "#212121" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
    { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
    { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
    { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
    { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
  ],
};

type WeatherCondition = "CLEAR" | "STORM" | "FOG";

interface Flight {
  id: string;
  altitude: number;
  fuel_level: number;
  status: "WAITING_FOR_TAKEOFF" | "IN_FLIGHT" | "APPROACHING" | "LANDED" | "DIVERTED" | "CRASHED" | "HOLDING";
  distance_to_primary: number;
  history: { lat: number, lng: number }[];
  isEmergency?: boolean;
}

interface Airport {
  id: string;
  distance: number;
}

interface LogEntry {
  step: number;
  action: string;
  flightId: string;
  reward: number;
  event?: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export default function App() {
  // ... (existing state)
  const [flights, setFlights] = useState<Flight[]>([
    { id: "AA123", altitude: 30000, fuel_level: 0.8, status: "IN_FLIGHT", distance_to_primary: 100, history: [], isEmergency: false },
    { id: "UA456", altitude: 0, fuel_level: 0.9, status: "WAITING_FOR_TAKEOFF", distance_to_primary: 0, history: [], isEmergency: false },
    { id: "EMERG-1", altitude: 15000, fuel_level: 0.12, status: "APPROACHING", distance_to_primary: 40, history: [], isEmergency: true }
  ]);
  const [nearbyAirports] = useState<Airport[]>([
    { id: "ALT-1", distance: 50 },
    { id: "ALT-2", distance: 120 }
  ]);
  const [runwayOccupiedUntil, setRunwayOccupiedUntil] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [primaryClosed, setPrimaryClosed] = useState(false);
  const [weather, setWeather] = useState<WeatherCondition>("CLEAR");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalReward, setTotalReward] = useState(0);
  const [selectedFlight, setSelectedFlight] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const isKeyValid = googleMapsApiKey && googleMapsApiKey !== "YOUR_GOOGLE_MAPS_API_KEY" && googleMapsApiKey.length > 10;

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: isKeyValid ? googleMapsApiKey : "",
  });

  useEffect(() => {
    if (!isKeyValid) {
      console.warn("Google Maps API Key is missing or invalid. Falling back to Tactical Radar.");
      setAuthFailed(true);
    }
    
    // Handle global Google Maps auth failures (like ApiProjectMapError or InvalidKeyMapError)
    (window as any).gm_authFailure = () => {
      console.error("Google Maps Auth Failure detected");
      setAuthFailed(true);
    };
  }, [isKeyValid]);

  useEffect(() => {
    if (flights.every(f => f.history.length === 0)) {
      setFlights(prev => prev.map((f, i) => {
        const angle = (i * (360 / prev.length)) * (Math.PI / 180);
        const distanceScale = 0.001;
        const lat = MAP_CENTER.lat + (f.distance_to_primary * distanceScale * Math.cos(angle));
        const lng = MAP_CENTER.lng + (f.distance_to_primary * distanceScale * Math.sin(angle));
        return { ...f, history: [{ lat, lng }] };
      }));
    }
  }, [flights.length]);

  // Gemini State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [showCoPilot, setShowCoPilot] = useState(false);
  const [mapType, setMapType] = useState<"roadmap" | "satellite" | "hybrid" | "terrain">("roadmap");
  const [diversionTargets, setDiversionTargets] = useState<Record<string, string>>({});
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const alertedFlights = useRef<Record<string, number>>({});

  const playBeep = (frequency: number, duration: number, pulses: number = 1) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      for (let i = 0; i < pulses; i++) {
        const startTime = ctx.currentTime + (i * (duration + 0.1));
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, startTime);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      }
    } catch (e) {
      console.warn("Audio alert failed:", e);
    }
  };

  useEffect(() => {
    flights.forEach(f => {
      if (["CRASHED", "LANDED", "DIVERTED"].includes(f.status)) return;
      
      const currentLevel = f.fuel_level * 100;
      const lastAlertLevel = alertedFlights.current[f.id] || 100;

      if (currentLevel <= 10 && lastAlertLevel > 10) {
        playBeep(880, 0.2, 3); // Critical: 3 high-pitch pulses
        alertedFlights.current[f.id] = 10;
      } else if (currentLevel <= 20 && lastAlertLevel > 20) {
        playBeep(440, 0.3, 1); // Caution: 1 mid-pitch pulse
        alertedFlights.current[f.id] = 20;
      }
      
      // Reset alert if fuel is replenished (e.g. on reset)
      if (currentLevel > 20 && lastAlertLevel <= 20) {
        alertedFlights.current[f.id] = 100;
      }
    });
  }, [flights]);

  const startLiveSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are a real-time ATC voice assistant. 
          Current State: ${JSON.stringify(flights)}. 
          Listen to the user's voice commands and provide immediate feedback or analysis.`,
        },
        callbacks: {
          onopen: () => {
            console.log("Live session opened");
            startMicrophone();
          },
          onmessage: async (message) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              playAudio(base64Audio);
            }
          },
          onclose: () => {
            console.log("Live session closed");
            stopMicrophone();
          }
        }
      });
      sessionRef.current = session;
      setIsLiveActive(true);
    } catch (error) {
      console.error("Live API Error:", error);
    }
  };

  const stopLiveSession = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setIsLiveActive(false);
  };

  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (e) => {
        if (!sessionRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert to 16-bit PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        sessionRef.current.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };
    } catch (error) {
      console.error("Mic Error:", error);
    }
  };

  const stopMicrophone = () => {
    audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const playAudio = async (base64Data: string) => {
    if (!audioContextRef.current) return;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x7FFF;
    }
    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 16000);
    buffer.getChannelData(0).set(floatData);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start();
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isRunwayAvailable = runwayOccupiedUntil <= currentTime && !primaryClosed;

  const flightPositions = useMemo(() => {
    return flights.map((f, i) => {
      const angle = (i * (360 / flights.length)) * (Math.PI / 180);
      const distanceScale = 0.001; // Scale KM to Lat/Lng diff
      return {
        ...f,
        lat: MAP_CENTER.lat + (f.distance_to_primary * distanceScale * Math.cos(angle)),
        lng: MAP_CENTER.lng + (f.distance_to_primary * distanceScale * Math.sin(angle)),
      };
    });
  }, [flights]);

  const reset = () => {
    setFlights([
      { id: "AA123", altitude: 30000, fuel_level: 0.8, status: "IN_FLIGHT", distance_to_primary: 100, history: [] },
      { id: "UA456", altitude: 0, fuel_level: 0.9, status: "WAITING_FOR_TAKEOFF", distance_to_primary: 0, history: [] },
      { id: "EMERG-1", altitude: 15000, fuel_level: 0.12, status: "APPROACHING", distance_to_primary: 40, history: [] }
    ]);
    setCurrentTime(0);
    setRunwayOccupiedUntil(0);
    setPrimaryClosed(false);
    setLogs([]);
    setTotalReward(0);
    setMessages([]);
  };

  const step = (actionType: string, flightId: string, targetId?: string) => {
    let reward = 0;
    let event = "";
    const nextTime = currentTime + 1;
    
    // Dynamic Weather Transition (10% chance to change)
    if (Math.random() < 0.1) {
      const conditions: WeatherCondition[] = ["CLEAR", "STORM", "FOG"];
      const nextWeather = conditions[Math.floor(Math.random() * conditions.length)];
      if (nextWeather !== weather) {
        setWeather(nextWeather);
        setLogs(prev => [{ step: nextTime, action: "weather_change", flightId: "SYSTEM", reward: 0, event: `Weather changed to ${nextWeather}` }, ...prev]);
      }
    }

    const fuelBurnMultiplier = weather === "STORM" ? 2.5 : 1.0;
    const runwayTimeMultiplier = weather === "FOG" ? 2.0 : (weather === "STORM" ? 1.5 : 1.0);

    const newFlights = flights.map((f, i) => {
      let newF = { ...f };
      
      if (["IN_FLIGHT", "APPROACHING", "HOLDING"].includes(newF.status)) {
        newF.fuel_level = Math.max(0, newF.fuel_level - (0.01 * fuelBurnMultiplier));
        
        // Emergency Flagging
        if (newF.fuel_level < 0.15 && !newF.isEmergency) {
          newF.isEmergency = true;
          event = `MAYDAY: Flight ${newF.id} declared emergency (Low Fuel)`;
          
          // Proactive Co-pilot Suggestion
          if (!alertedFlights.current[`${newF.id}_copilot`]) {
            const suggestion = `ALERT: Flight ${newF.id} is at critical fuel (15%). Recommendation: Divert to nearby node or clear runway for immediate emergency landing.`;
            setMessages(prev => [...prev, { role: 'assistant', text: suggestion }]);
            alertedFlights.current[`${newF.id}_copilot`] = 1;
            setShowCoPilot(true);
          }
        }

        // Audio Alerts for Fuel
        const lastAlert = alertedFlights.current[newF.id] || 1.0;
        if (newF.fuel_level < 0.1 && lastAlert >= 0.1) {
          playBeep(880, 0.3, 3); // High pitch triple beep for 10%
          alertedFlights.current[newF.id] = 0.1;
        } else if (newF.fuel_level < 0.2 && lastAlert >= 0.2) {
          playBeep(440, 0.2, 2); // Medium pitch double beep for 20%
          alertedFlights.current[newF.id] = 0.2;
        }

        if (newF.status === "APPROACHING") {
          newF.distance_to_primary = Math.max(0, newF.distance_to_primary - 10);
        }
        if (newF.fuel_level <= 0) {
          newF.status = "CRASHED";
          reward -= 10;
          event = `Flight ${newF.id} crashed (Fuel)`;
        }
      }

      if (f.id === flightId) {
        if (actionType === "approve_takeoff") {
          if (f.status === "WAITING_FOR_TAKEOFF" && isRunwayAvailable) {
            newF.status = "IN_FLIGHT";
            newF.altitude = 5000;
            setRunwayOccupiedUntil(nextTime + Math.round(3 * runwayTimeMultiplier));
            reward += 1.0;
            event = `Takeoff approved for ${f.id}`;
          } else {
            reward -= 0.5;
            event = `Takeoff failed for ${f.id} (Runway busy or closed)`;
          }
        } else if (actionType === "approve_landing") {
          if (["APPROACHING", "IN_FLIGHT", "HOLDING"].includes(f.status) && isRunwayAvailable) {
            newF.status = "LANDED";
            newF.altitude = 0;
            newF.distance_to_primary = 0;
            setRunwayOccupiedUntil(nextTime + Math.round(7 * runwayTimeMultiplier));
            reward += 1.0;
            event = `Landing approved for ${f.id}`;
          } else {
            reward -= 0.5;
            event = `Landing failed for ${f.id} (Runway busy or closed)`;
          }
        } else if (actionType === "emergency_landing") {
          if (["APPROACHING", "IN_FLIGHT", "HOLDING"].includes(f.status)) {
            newF.status = "LANDED";
            newF.altitude = 0;
            newF.distance_to_primary = 0;
            const conflict = !isRunwayAvailable;
            setRunwayOccupiedUntil(nextTime + Math.round(10 * runwayTimeMultiplier));
            reward += conflict ? -5.0 : 2.0;
            event = conflict 
              ? `EMERGENCY LANDING: ${f.id} landed with RUNWAY CONFLICT!` 
              : `EMERGENCY LANDING: ${f.id} landed safely (Priority)`;
          }
        } else if (actionType === "hold_pattern") {
          newF.status = "HOLDING";
          reward -= 0.1;
          event = `${f.id} holding`;
        } else if (actionType === "divert_to_nearby") {
          const alt = nearbyAirports.find(a => a.id === targetId);
          if (alt) {
            const fuelNeeded = alt.distance * 0.002 * fuelBurnMultiplier;
            if (newF.fuel_level >= fuelNeeded) {
              newF.status = "DIVERTED";
              newF.fuel_level -= fuelNeeded;
              reward += 0.8;
              event = `${f.id} diverted to ${alt.id}`;
            } else {
              newF.status = "CRASHED";
              reward -= 10;
              event = `${f.id} crashed during diversion`;
            }
          }
        }
      }

      // Record history
      const angle = (i * (360 / flights.length)) * (Math.PI / 180);
      const distanceScale = 0.001; // Scale KM to Lat/Lng diff
      const currentLat = MAP_CENTER.lat + (newF.distance_to_primary * distanceScale * Math.cos(angle));
      const currentLng = MAP_CENTER.lng + (newF.distance_to_primary * distanceScale * Math.sin(angle));
      
      newF.history = [...newF.history, { lat: currentLat, lng: currentLng }];

      return newF;
    });

    setFlights(newFlights);
    setCurrentTime(nextTime);
    setTotalReward(prev => prev + reward);
    setLogs([{ step: nextTime, action: actionType, flightId, reward, event }, ...logs]);
  };

  const askCoPilot = async (query: string) => {
    if (!query.trim()) return;
    
    const userMsg: Message = { role: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsAnalyzing(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // Use High Thinking for complex analysis if requested or implied
      const isComplex = query.toLowerCase().includes("analyze") || query.toLowerCase().includes("strategy") || query.toLowerCase().includes("complex");
      const modelName = isComplex ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
      
      const systemInstruction = `You are an expert ATC Co-pilot, now enhanced with insights from the "MGH Framework" research (2025).
      
      Research Context (MGH Framework):
      - Methodology: Combines GAN (Generative Adversarial Networks) for environment modeling and HER (Hindsight Experience Replay) for sample efficiency.
      - Performance: Achieves up to 70.59% faster convergence in sparse-reward drone tasks.
      - Architecture: Uses WGAN-GP for transition modeling and DDPG for policy optimization.
      - Real-world Data: Validated on DJI RMTT platforms using 10K real-world samples.
      
      Current Airspace State:
      - Flights: ${JSON.stringify(flights)}
      - Runway Available: ${isRunwayAvailable}
      - Primary Airport Closed: ${primaryClosed}
      - Nearby Airports: ${JSON.stringify(nearbyAirports)}
      - Current Time: T+${currentTime}
      
      Provide strategic advice based on this high-efficiency learning paradigm. Analyze risks and suggest actions.`;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: query }] }],
        config: {
          systemInstruction,
          tools: [
            { googleSearch: {} },
            { googleMaps: {} }
          ],
          thinkingConfig: isComplex ? { thinkingLevel: ThinkingLevel.HIGH } : undefined
        }
      });

      const aiMsg: Message = { role: 'model', text: response.text || "I'm analyzing the situation..." };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error("Gemini Error:", error);
      setMessages(prev => [...prev, { role: 'model', text: "Error connecting to ATC Intelligence. Please check connection." }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/10 p-6 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Plane className="text-black" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">Sky Control Center</h1>
            <p className="text-xs text-white/40 font-mono">OPENENV SIMULATION v1.0.0</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowCoPilot(!showCoPilot)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${showCoPilot ? 'bg-orange-500 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
          >
            <Sparkles size={14} />
            {showCoPilot ? 'HIDE CO-PILOT' : 'SHOW CO-PILOT'}
          </button>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-right">
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Total Reward</p>
            <p className={`text-xl font-mono ${totalReward >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalReward.toFixed(1)}
            </p>
          </div>
          <button 
            onClick={reset}
            className="p-2 hover:bg-white/5 rounded-full transition-colors group"
          >
            <RefreshCw size={20} className="text-white/60 group-hover:rotate-180 transition-transform duration-500" />
          </button>
        </div>
      </header>
      
      {/* Emergency Global Alert */}
      <AnimatePresence>
        {flights.some(f => f.isEmergency && !["LANDED", "CRASHED", "DIVERTED"].includes(f.status)) && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-red-600/90 backdrop-blur-md border border-red-500 text-white p-4 rounded-2xl shadow-2xl shadow-red-600/40 flex items-center gap-4 ring-2 ring-red-500 animate-pulse">
              <div className="bg-white/20 p-2 rounded-xl">
                <AlertTriangle className="text-white" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black uppercase tracking-[0.2em]">Mayday Mayday Mayday</h3>
                <p className="text-[10px] text-red-100 font-medium uppercase tracking-wider opacity-80">
                  Multiple aircraft in emergency state. Clear runways immediately.
                </p>
              </div>
              <div className="text-right">
                <div className="text-[8px] font-bold bg-white text-red-600 px-2 py-0.5 rounded-full uppercase">Priority 1</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Low Fuel Global Alert */}
        {flights.some(f => f.fuel_level < 0.2 && !f.isEmergency && !["LANDED", "CRASHED", "DIVERTED"].includes(f.status)) && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 80, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[90] w-full max-w-md px-4"
          >
            <div className="bg-orange-500/90 backdrop-blur-md border border-orange-400 text-black p-3 rounded-xl shadow-xl flex items-center gap-4">
              <div className="bg-black/10 p-2 rounded-lg">
                <Fuel className="text-black" size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-black uppercase tracking-[0.1em]">Low Fuel Warning</h3>
                <p className="text-[9px] font-medium uppercase tracking-wider opacity-70">
                  Multiple aircraft approaching critical fuel levels.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-[1600px] mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-100px)]">
        {/* Left: Radar & Airspace */}
        <div className="lg:col-span-8 flex flex-col gap-6 overflow-hidden">
          {/* Radar View */}
          <section className="flex-1 bg-black border border-white/10 rounded-2xl relative overflow-hidden group">
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-black/80 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-white/60">Live Radar Feed</span>
            </div>

            <div className="absolute top-4 left-40 z-10 flex items-center gap-1 bg-black/80 backdrop-blur-md border border-white/10 p-1 rounded-full">
              <button 
                onClick={() => setMapType('roadmap')}
                className={`px-2 py-1 text-[8px] font-bold uppercase tracking-tighter rounded-full transition-all ${mapType === 'roadmap' ? 'bg-orange-500 text-black' : 'text-white/40 hover:text-white'}`}
              >
                Tactical
              </button>
              <button 
                onClick={() => setMapType('hybrid')}
                className={`px-2 py-1 text-[8px] font-bold uppercase tracking-tighter rounded-full transition-all ${mapType === 'hybrid' ? 'bg-orange-500 text-black' : 'text-white/40 hover:text-white'}`}
              >
                Satellite
              </button>
            </div>

            {/* Radar Sweep Effect */}
            <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden rounded-2xl">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute top-1/2 left-1/2 w-[200%] h-[200%] -translate-x-1/2 -translate-y-1/2 origin-center"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg, rgba(34, 197, 94, 0.1) 350deg, rgba(34, 197, 94, 0.2) 360deg)'
                }}
              />
              {/* Radar Grid Lines */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'radial-gradient(circle at center, transparent 0%, transparent 90%, rgba(255,255,255,0.1) 90%, rgba(255,255,255,0.1) 100%), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
                backgroundSize: '100px 100px, 40px 40px, 40px 40px',
                backgroundPosition: 'center center'
              }} />
            </div>
            
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
              <div className="bg-black/80 backdrop-blur-md border border-white/10 p-3 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[8px] text-white/40 uppercase tracking-widest">Wind</span>
                  <span className="text-[10px] font-mono text-green-400">240° @ 12KT</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[8px] text-white/40 uppercase tracking-widest">Vis</span>
                  <span className="text-[10px] font-mono text-green-400">10SM</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[8px] text-white/40 uppercase tracking-widest">QNH</span>
                  <span className="text-[10px] font-mono text-green-400">29.92 IN</span>
                </div>
              </div>
            </div>

            {isLoaded && !loadError && !authFailed ? (
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={MAP_CENTER}
                zoom={11}
                options={{
                  ...mapOptions,
                  mapTypeId: mapType
                }}
              >
                {/* Primary Airport */}
                <Marker
                  position={AIRPORT_COORDS.PRIMARY}
                  icon={{
                    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                    fillColor: primaryClosed ? "#ef4444" : "#22c55e",
                    fillOpacity: 1,
                    strokeWeight: 1,
                    strokeColor: "#ffffff",
                    scale: 1.5,
                  }}
                  title="Primary Airport (SFO)"
                />

                {/* Nearby Airports */}
                {nearbyAirports.map(alt => (
                  <Marker
                    key={alt.id}
                    position={AIRPORT_COORDS[alt.id] || MAP_CENTER}
                    icon={{
                      path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
                      fillColor: "#3b82f6",
                      fillOpacity: 0.8,
                      strokeWeight: 1,
                      strokeColor: "#ffffff",
                      scale: 1,
                    }}
                    label={{
                      text: alt.id,
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: "bold",
                    }}
                  />
                ))}

                {/* Flights */}
                {flightPositions.map(f => (
                  <React.Fragment key={f.id}>
                    {(selectedFlight === f.id || f.isEmergency) && f.history.length > 1 && (
                      <>
                        {/* Glow Effect Polyline */}
                        <Polyline
                          path={f.history}
                          options={{
                            strokeColor: f.isEmergency ? "#ef4444" : "#f97316",
                            strokeOpacity: f.isEmergency ? 0.4 : 0.3,
                            strokeWeight: f.isEmergency ? 10 : 8,
                          }}
                        />
                        {/* Core Path Polyline */}
                        <Polyline
                          path={f.history}
                          options={{
                            strokeColor: f.isEmergency ? "#ef4444" : "#f97316",
                            strokeOpacity: 1,
                            strokeWeight: f.isEmergency ? 3 : 2,
                            icons: [{
                              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
                              offset: '0',
                              repeat: '10px'
                            }],
                          }}
                        />
                      </>
                    )}
                      <Marker
                        position={{ lat: f.lat, lng: f.lng }}
                        onClick={() => setSelectedFlight(f.id)}
                        icon={{
                          path: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
                          fillColor: f.status === 'CRASHED' ? '#ef4444' : f.status === 'LANDED' ? '#22c55e' : (f.isEmergency ? '#ef4444' : '#f97316'),
                          fillOpacity: 1,
                          strokeWeight: f.isEmergency ? 3 : (f.fuel_level < 0.2 ? 2 : 1),
                          strokeColor: f.isEmergency ? "#ffffff" : (f.fuel_level < 0.1 ? "#ef4444" : f.fuel_level < 0.2 ? "#f97316" : "#ffffff"),
                          scale: f.isEmergency ? 1.8 : (f.fuel_level < 0.1 ? 1.5 : 1.2),
                          rotation: f.status === 'HOLDING' ? 45 : 0,
                        }}
                      />
                    {selectedFlight === f.id && (
                      <InfoWindow
                        position={{ lat: f.lat, lng: f.lng }}
                        onCloseClick={() => setSelectedFlight(null)}
                      >
                        <div className="text-black p-2 space-y-1 min-w-[120px]">
                          <p className="font-bold border-b pb-1">{f.id}</p>
                          <p className="text-[10px]">Alt: {f.altitude}ft</p>
                          <p className="text-[10px]">Fuel: {(f.fuel_level * 100).toFixed(0)}%</p>
                          <p className="text-[10px] font-bold text-orange-600 uppercase">{f.status}</p>
                        </div>
                      </InfoWindow>
                    )}
                  </React.Fragment>
                ))}

                {/* Radar Rings */}
                <Circle
                  center={MAP_CENTER}
                  radius={20000}
                  options={{
                    strokeColor: "#22c55e",
                    strokeOpacity: 0.1,
                    strokeWeight: 1,
                    fillColor: "transparent",
                  }}
                />
                <Circle
                  center={MAP_CENTER}
                  radius={40000}
                  options={{
                    strokeColor: "#22c55e",
                    strokeOpacity: 0.05,
                    strokeWeight: 1,
                    fillColor: "transparent",
                  }}
                />
              </GoogleMap>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#0d1117] p-12 text-center relative overflow-hidden">
                {/* Enhanced Mock Radar Background with Topographic Feel */}
                <div className="absolute inset-0 pointer-events-none opacity-20">
                  <svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
                    {/* Stylized Bay Area Landmass */}
                    <path d="M0,100 Q50,80 100,120 T200,100 T300,150 T400,120 V400 H0 Z" fill="#1a202c" />
                    <path d="M0,150 Q70,130 120,170 T220,150 T320,200 T400,170 V400 H0 Z" fill="#2d3748" opacity="0.5" />
                    
                    {/* Grid Lines */}
                    <circle cx="200" cy="200" r="50" fill="none" stroke="#22c55e" strokeWidth="0.2" strokeDasharray="2 2" />
                    <circle cx="200" cy="200" r="100" fill="none" stroke="#22c55e" strokeWidth="0.2" strokeDasharray="4 4" />
                    <circle cx="200" cy="200" r="150" fill="none" stroke="#22c55e" strokeWidth="0.2" />
                    <line x1="200" y1="0" x2="200" y2="400" stroke="#22c55e" strokeWidth="0.1" />
                    <line x1="0" y1="200" x2="400" y2="200" stroke="#22c55e" strokeWidth="0.1" />
                    
                    {/* Topographic Contours */}
                    {[1, 2, 3, 4, 5].map(i => (
                      <circle key={i} cx="350" cy="50" r={i * 20} fill="none" stroke="#ffffff" strokeWidth="0.05" opacity="0.1" />
                    ))}
                    
                    {/* Render Flights on Mock Radar */}
                    {flightPositions.map((f, i) => {
                      const angle = (i * (360 / flights.length)) * (Math.PI / 180);
                      const r = (f.distance_to_primary / 150) * 150; // Scale distance to SVG radius
                      const x = 200 + r * Math.cos(angle);
                      const y = 200 + r * Math.sin(angle);
                      
                      // Calculate history points for SVG
                      const historyPoints = f.history.map(p => {
                        const dist = Math.sqrt(Math.pow(p.lat - MAP_CENTER.lat, 2) + Math.pow(p.lng - MAP_CENTER.lng, 2)) / 0.001;
                        const hr = (dist / 150) * 150;
                        return `${200 + hr * Math.cos(angle)},${200 + hr * Math.sin(angle)}`;
                      }).join(' ');

                      const isSelected = selectedFlight === f.id;

                      return (
                        <g key={f.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedFlight(f.id)}>
                          {f.history.length > 1 && (
                            <polyline 
                              points={historyPoints} 
                              fill="none" 
                              stroke={isSelected ? (f.isEmergency ? '#ef4444' : '#f97316') : '#22c55e'} 
                              strokeWidth={isSelected ? "1.5" : "0.5"} 
                              strokeDasharray={isSelected ? "none" : "2 2"} 
                              opacity={isSelected ? "0.8" : "0.2"}
                              className={isSelected ? "animate-pulse" : ""}
                            />
                          )}
                          <motion.circle 
                            cx={x} cy={y} r={isSelected ? "6" : (f.fuel_level < 0.1 ? "5" : "3")} 
                            fill={f.status === 'CRASHED' || f.fuel_level < 0.1 ? '#ef4444' : f.fuel_level < 0.2 ? '#f97316' : '#22c55e'}
                            stroke={isSelected ? "#ffffff" : "none"}
                            strokeWidth="1"
                            initial={{ opacity: 0 }}
                            animate={{ 
                              opacity: [0.2, 1, 0.2],
                              scale: isSelected ? [1, 1.2, 1] : (f.fuel_level < 0.2 ? [1, 1.5, 1] : 1)
                            }}
                            transition={{ duration: f.fuel_level < 0.1 ? 0.5 : 2, repeat: Infinity }}
                          />
                          <text x={x + 8} y={y - 8} fill={isSelected ? "#ffffff" : "#22c55e"} fontSize={isSelected ? "8" : "6"} fontFamily="monospace" fontWeight="bold">
                            {f.id}
                          </text>
                        </g>
                      );
                    })}

                    <motion.line 
                      x1="200" y1="200" x2="200" y2="50" 
                      stroke="#22c55e" strokeWidth="2"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      style={{ originX: "200px", originY: "200px" }}
                    />
                  </svg>
                </div>

                <div className="max-w-md space-y-6 z-10 bg-black/60 backdrop-blur-md p-8 rounded-3xl border border-white/10">
                  <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                    <AlertTriangle className="text-red-500/60" size={32} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-white/80">Radar System Offline</h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">
                      The Google Maps API key is either missing, invalid, or unauthorized for this project. 
                      Follow the steps below to restore radar capabilities.
                    </p>
                  </div>
                  
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-left space-y-3">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-orange-500/60">Configuration Steps:</p>
                    <ol className="text-[9px] text-white/60 space-y-2 list-decimal pl-4">
                      <li>Go to <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" className="text-blue-400 hover:underline">Google Cloud Console</a>.</li>
                      <li>Ensure <strong>Maps JavaScript API</strong> is enabled for your project.</li>
                      <li>Create an API Key and restrict it to your app's domain if needed.</li>
                      <li>Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your environment variables in the Settings menu.</li>
                    </ol>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-[8px] text-white/20 uppercase tracking-widest">Error Code: {loadError || authFailed ? 'API_AUTH_FAILURE' : 'INITIALIZING'}</p>
                    <button 
                      onClick={() => window.location.reload()}
                      className="px-6 py-2 bg-orange-500 text-black rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all hover:bg-orange-400"
                    >
                      Retry Connection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Overlay Grid */}
            <div className="absolute inset-0 pointer-events-none border border-white/5 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)]" />
            <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            
            {/* Weather Overlays */}
            <AnimatePresence>
              {weather === "STORM" && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.4 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 pointer-events-none bg-blue-900/20 mix-blend-overlay z-20"
                >
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 animate-pulse" />
                  <div className="absolute inset-0 opacity-30 mix-blend-overlay" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/stardust.png")' }} />
                  {/* Lightning flashes */}
                  <motion.div 
                    animate={{ opacity: [0, 0, 0.8, 0, 0.5, 0] }}
                    transition={{ duration: 5, repeat: Infinity, times: [0, 0.8, 0.82, 0.84, 0.86, 1] }}
                    className="absolute inset-0 bg-white/10"
                  />
                </motion.div>
              )}
              {weather === "FOG" && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.7 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 pointer-events-none bg-gray-500/30 backdrop-blur-[3px] z-20"
                >
                  <div className="absolute inset-0 opacity-20 animate-pulse" style={{ 
                    background: 'radial-gradient(circle at 50% 50%, transparent 0%, rgba(255,255,255,0.1) 100%)',
                    filter: 'blur(20px)'
                  }} />
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Airspace Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[280px]">
            <section className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <Navigation size={12} className="text-white/40" />
                  <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">Runway Operations</h2>
                </div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-colors duration-500 ${primaryClosed ? 'bg-red-500/20 text-red-400' : (isRunwayAvailable ? 'bg-green-500/20 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'bg-orange-500/20 text-orange-400')}`}>
                  {primaryClosed ? 'CLOSED' : (isRunwayAvailable ? 'RUNWAY CLEAR' : `IN USE: ${runwayOccupiedUntil - currentTime}s`)}
                </span>
              </div>
              
              <div className="flex-1 flex flex-col justify-center gap-4">
                <div className={`h-16 bg-black/60 border rounded-xl flex items-center justify-center relative overflow-hidden transition-all duration-500 ${isRunwayAvailable && !primaryClosed ? 'border-green-500/30' : 'border-white/5'}`}>
                  {/* Digital Grid Background */}
                  <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 0)', backgroundSize: '10px 10px' }} />
                  
                  <div className="absolute inset-0 flex items-center justify-center opacity-10">
                    <div className="w-full h-px border-t border-dashed border-white" />
                  </div>
                  
                  <span className="absolute left-4 text-[10px] font-mono text-white/20">RWY 09L</span>
                  <span className="absolute right-4 text-[10px] font-mono text-white/20">RWY 27R</span>
                  
                  {isRunwayAvailable && !primaryClosed && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center"
                    >
                      <CheckCircle size={16} className="text-green-500 mb-1" />
                      <span className="text-[8px] font-bold text-green-500/60 uppercase tracking-[0.2em]">Ready for Clearance</span>
                    </motion.div>
                  )}

                  {!isRunwayAvailable && !primaryClosed && (
                    <>
                      <motion.div 
                        initial={{ x: -150, opacity: 0 }}
                        animate={{ x: 150, opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                        className="z-10"
                      >
                        <Plane size={24} className="text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                      </motion.div>
                      
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                        <div className="flex items-center gap-2 text-[10px] font-mono text-orange-400 font-bold tracking-widest">
                          <RefreshCw size={10} className="animate-spin" />
                          T-MINUS {runwayOccupiedUntil - currentTime}s
                        </div>
                        <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            initial={{ width: "100%" }}
                            animate={{ width: "0%" }}
                            transition={{ duration: runwayOccupiedUntil - currentTime, ease: "linear" }}
                            className="h-full bg-gradient-to-r from-orange-600 to-orange-400"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                
                <button 
                  onClick={() => setPrimaryClosed(!primaryClosed)}
                  className={`w-full py-3 rounded-xl text-[10px] font-bold tracking-widest uppercase transition-all ${primaryClosed ? 'bg-green-500/20 text-green-400 border border-green-500/20 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30'}`}
                >
                  {primaryClosed ? 'RESUME OPERATIONS' : 'HALT ALL OPERATIONS'}
                </button>
              </div>
            </section>

            <section className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <MapPin size={12} className="text-white/40" />
                <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">Diversion Nodes</h2>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto pr-2 scrollbar-hide">
                {nearbyAirports.map(alt => (
                  <div key={alt.id} className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/20 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                        <MapPin size={14} />
                      </div>
                      <span className="text-xs font-mono font-bold tracking-tight">{alt.id}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-mono text-white/80">{alt.distance} KM</p>
                      <p className="text-[8px] text-white/20 uppercase tracking-widest">ETA: {Math.round(alt.distance / 10)} MIN</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Right: Flight List & Co-pilot */}
        <div className="lg:col-span-4 flex flex-col gap-6 overflow-hidden">
          {/* Active Airspace List */}
          <section className="flex-1 bg-white/5 border border-white/10 rounded-2xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Crosshair size={12} className="text-white/40" />
                <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">Active Airspace</h2>
              </div>
              <span className="text-[8px] font-mono text-white/20">{flights.length} TRACKS</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
              {flights.map(f => (
                <div 
                  key={f.id} 
                  onClick={() => setSelectedFlight(f.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden group ${
                    selectedFlight === f.id ? 'bg-orange-500/10 border-orange-500/40 shadow-lg shadow-orange-500/5' : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'
                  } ${f.fuel_level < 0.1 ? 'ring-1 ring-red-500/50 animate-pulse' : f.fuel_level < 0.2 ? 'ring-1 ring-orange-500/30' : ''}`}
                >
                  {/* Scanline Effect */}
                  <div className="absolute inset-0 pointer-events-none opacity-[0.03] group-hover:opacity-[0.05] transition-opacity" style={{
                    backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
                    backgroundSize: '100% 2px, 3px 100%'
                  }} />
                  {f.isEmergency && !["LANDED", "CRASHED", "DIVERTED"].includes(f.status) && (
                    <div className="absolute top-0 right-0 px-2 py-0.5 text-[7px] font-bold uppercase tracking-tighter bg-red-600 text-white animate-pulse flex flex-col items-end">
                      <div className="flex items-center gap-1">
                        <AlertTriangle size={8} /> MAYDAY / EMERGENCY
                      </div>
                      <div className="text-[6px] opacity-80">DIVERSION RECOMMENDED</div>
                    </div>
                  )}
                  {f.fuel_level < 0.2 && !f.isEmergency && !["LANDED", "CRASHED", "DIVERTED"].includes(f.status) && (
                    <div className="absolute top-0 right-0 px-2 py-0.5 text-[7px] font-bold uppercase tracking-tighter bg-orange-500 text-black">
                      Low Fuel
                    </div>
                  )}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        f.status === 'CRASHED' ? 'bg-red-500/20 text-red-400' :
                        f.status === 'LANDED' ? 'bg-green-500/20 text-green-400' :
                        'bg-orange-500/20 text-orange-400'
                      }`}>
                        <Plane size={16} className={f.status === 'HOLDING' ? 'animate-pulse' : ''} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            f.status === 'LANDED' ? 'bg-green-500' :
                            f.status === 'CRASHED' ? 'bg-red-500' :
                            f.status === 'HOLDING' ? 'bg-yellow-500 animate-pulse' :
                            'bg-blue-500'
                          }`} />
                          <p className="text-xs font-mono font-bold">{f.id}</p>
                        </div>
                        <p className="text-[8px] text-white/40 uppercase tracking-widest">{f.status}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-mono text-white/80">{f.altitude} FT</p>
                      <p className="text-[8px] text-white/20 uppercase">Altitude</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] uppercase tracking-widest text-white/40">
                        <span>Fuel</span>
                        <span className={f.fuel_level < 0.2 ? 'text-red-400' : 'text-white/60'}>{(f.fuel_level * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${f.fuel_level * 100}%` }}
                          className={`h-full ${f.fuel_level < 0.2 ? 'bg-red-500' : 'bg-green-500'}`} 
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[8px] text-white/40 uppercase tracking-widest">Distance</p>
                      <p className="text-[10px] font-mono text-white/80">{f.distance_to_primary} KM</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {f.isEmergency && !["LANDED", "CRASHED", "DIVERTED"].includes(f.status) && (
                      <div className="flex-1 flex flex-col gap-1">
                        <p className="text-[7px] text-red-400 font-bold uppercase tracking-widest mb-1">Emergency Protocol Required</p>
                        <div className="flex gap-1">
                          <button 
                            onClick={(e) => { e.stopPropagation(); step('emergency_landing', f.id); }} 
                            className="flex-1 py-1.5 bg-red-600 text-white rounded-lg text-[8px] font-bold hover:bg-red-700 transition-all uppercase tracking-widest shadow-lg shadow-red-600/20"
                          >
                            Priority Landing
                          </button>
                          <div className="flex-1 flex gap-1">
                            <select 
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setDiversionTargets(prev => ({ ...prev, [f.id]: e.target.value }))}
                              value={diversionTargets[f.id] || 'ALT-1'}
                              className="bg-black/40 text-white border border-white/20 rounded-lg text-[8px] px-1 font-mono outline-none focus:border-red-500/50"
                            >
                              {nearbyAirports.map(alt => (
                                <option key={alt.id} value={alt.id}>{alt.id}</option>
                              ))}
                            </select>
                            <button 
                              onClick={(e) => { e.stopPropagation(); step('divert_to_nearby', f.id, diversionTargets[f.id] || 'ALT-1'); }} 
                              className="flex-1 py-1.5 bg-white/10 text-white border border-white/20 rounded-lg text-[8px] font-bold hover:bg-white/20 transition-all uppercase tracking-widest"
                            >
                              Divert
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {!f.isEmergency && f.status === 'WAITING_FOR_TAKEOFF' && (
                      <button onClick={(e) => { e.stopPropagation(); step('approve_takeoff', f.id); }} className="flex-1 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-[8px] font-bold hover:bg-green-500/20 transition-colors uppercase tracking-widest">Approve Takeoff</button>
                    )}
                    {!f.isEmergency && ['IN_FLIGHT', 'APPROACHING', 'HOLDING'].includes(f.status) && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); step('approve_landing', f.id); }} className="flex-1 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-[8px] font-bold hover:bg-blue-500/20 transition-colors uppercase tracking-widest">Land</button>
                        <button onClick={(e) => { e.stopPropagation(); step('hold_pattern', f.id); }} className="flex-1 py-1.5 bg-white/5 text-white/60 border border-white/10 rounded-lg text-[8px] font-bold hover:bg-white/10 transition-colors uppercase tracking-widest">Hold</button>
                        <div className="flex-1 flex gap-1">
                          <select 
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setDiversionTargets(prev => ({ ...prev, [f.id]: e.target.value }))}
                            value={diversionTargets[f.id] || 'ALT-1'}
                            className="bg-black/40 text-white border border-white/20 rounded-lg text-[8px] px-1 font-mono outline-none focus:border-white/40"
                          >
                            {nearbyAirports.map(alt => (
                              <option key={alt.id} value={alt.id}>{alt.id}</option>
                            ))}
                          </select>
                          <button 
                            onClick={(e) => { e.stopPropagation(); step('divert_to_nearby', f.id, diversionTargets[f.id] || 'ALT-1'); }} 
                            className="flex-1 py-1.5 bg-white/5 text-white/60 border border-white/10 rounded-lg text-[8px] font-bold hover:bg-white/10 transition-colors uppercase tracking-widest"
                          >
                            Divert
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Co-pilot / Logs Toggle */}
          <section className="h-[300px] bg-white/5 border border-white/10 rounded-2xl flex flex-col overflow-hidden">
            <div className="p-2 bg-black/40 border-b border-white/10 flex gap-2">
              <button 
                onClick={() => setShowCoPilot(true)}
                className={`flex-1 py-2 rounded-lg text-[8px] font-bold tracking-widest uppercase transition-all ${showCoPilot ? 'bg-orange-500 text-black' : 'text-white/40 hover:bg-white/5'}`}
              >
                Co-pilot
              </button>
              <button 
                onClick={() => setShowCoPilot(false)}
                className={`flex-1 py-2 rounded-lg text-[8px] font-bold tracking-widest uppercase transition-all ${!showCoPilot ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Event Log
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden">
              {showCoPilot ? (
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                    {messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-2 opacity-20">
                        <Sparkles size={24} />
                        <p className="text-[8px] uppercase tracking-widest">AI Tactical Support Offline</p>
                      </div>
                    ) : (
                      messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[90%] p-2.5 rounded-xl text-[10px] leading-relaxed ${
                            msg.role === 'user' ? 'bg-orange-500 text-black font-bold' : 'bg-white/10 text-white/90 border border-white/5'
                          }`}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-3 bg-black/40 border-t border-white/10 space-y-3">
                    <div className="flex flex-wrap justify-center gap-2">
                      {[
                        { label: 'Analyze Risks', action: () => askCoPilot('Analyze current airspace risks') },
                        { label: 'MGH Architecture', action: () => setMessages(prev => [...prev, { role: 'model', text: "### MGH Framework Architecture (Research 2025)\n\n**1. Actor (DDPG):**\n- Input: 64x64 RGB Image\n- Layers: 3 Conv (Stride 4->2->1) + ReLU -> FC(1024->512) -> FC(512->3, Tanh)\n- Output: 3D Action (Roll, Pitch, Throttle)\n\n**2. Generator (GAN):**\n- Input: Current State + Action\n- Layers: Image Encoder (4 Downsampling Conv) -> Channel-wise Concat -> Decoder (4 Transposed Conv)\n- Output: Predicted Next Image\n\n**3. Discriminator (WGAN-GP):**\n- Input: Current/Next Image Pair + Action\n- Layers: Conv (Stride 2) + LayerNorm -> FC -> 1D Output\n\n**Key Result:** 70.59% improvement in learning speed over standard DDPG-HER." }]) },
                        { label: 'Training Stats', action: () => setMessages(prev => [...prev, { role: 'model', text: "### Training Hyperparameters (Table 2)\n\n- **Learning Rate (Actor/Critic):** 0.001\n- **Learning Rate (GAN):** 0.0002\n- **Batch Size:** 64\n- **Buffer Size:** 1,000,000 samples\n- **Discount Factor (γ):** 0.99\n- **HER k-value:** 5 re-labelings per trajectory\n- **GAN Iterations:** 5 per step\n\n*Source: Data-Efficient Reinforcement Learning Framework for Autonomous Flight (2025)*" }]) },
                        { label: 'Sim-to-Real Insights', action: () => askCoPilot('Explain how GANs solve the Sim-to-Real problem in drone flight') }
                      ].map(t => (
                        <button key={t.label} onClick={t.action} className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full text-[10px] text-white/60 border border-white/5 transition-colors">
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); askCoPilot(input); }} className="relative">
                      <input 
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Tactical query..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-3 pr-8 text-[10px] focus:outline-none focus:border-orange-500/50 transition-all"
                      />
                      <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-orange-500">
                        <Send size={12} />
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-4 space-y-2 font-mono text-[9px] scrollbar-hide">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-3 text-white/40 border-b border-white/5 pb-2">
                      <span className="text-orange-500/60">T+{log.step}</span>
                      <span className="flex-1 text-white/80">{log.event}</span>
                      <span className={log.reward >= 0 ? 'text-green-500/60' : 'text-red-500/60'}>
                        {log.reward >= 0 ? '+' : ''}{log.reward.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black border-t border-white/10 px-6 py-3 flex justify-between items-center text-[10px] font-mono text-white/40 uppercase tracking-widest">
        <div className="flex gap-4">
          <span className={`flex items-center gap-1 transition-colors ${weather === 'STORM' ? 'text-red-400' : weather === 'FOG' ? 'text-yellow-400' : 'text-white/40'}`}>
            <Cloud size={10} /> Weather: {weather}
          </span>
          <span className="flex items-center gap-1"><AlertTriangle size={10} /> Alert Level: {weather === 'STORM' ? 'HIGH' : 'NORMAL'}</span>
          <div className="h-4 w-px bg-white/10 mx-2" />
          <span className="flex items-center gap-1 text-orange-500/60"><Activity size={10} /> MGH Framework: Active (70.59% Eff.)</span>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex gap-1">
            {(["CLEAR", "STORM", "FOG"] as WeatherCondition[]).map(w => (
              <button 
                key={w}
                onClick={() => setWeather(w)}
                className={`px-2 py-0.5 rounded border ${weather === w ? 'bg-white/10 border-white/20 text-white' : 'border-transparent hover:bg-white/5'}`}
              >
                {w}
              </button>
            ))}
          </div>
          <span>System Status: <span className="text-green-500">Operational</span></span>
        </div>
      </footer>
    </div>
  );
}
