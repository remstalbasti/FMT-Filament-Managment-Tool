import './index.css';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserMultiFormatReader, NotFoundException, DecodeHintType } from '@zxing/library';
import namer from 'color-namer';
import QRCode from 'qrcode';

// --- Interfaces ---
interface Printer {
    id: string;
    name: string;
    manufacturer: string;
    nozzle: string;
    filamentDiameter: number;
}

interface Filament {
  id: string;

  // Spule Details
  status: 'Originalverpackt' | 'Angebrochen' | 'Auf Drucker';
  manufacturer: string;
  manufacturerColor: string;
  type: string;
  color: string;
  colorHex: string;
  madeDate: string;

  // Abmessungen / Gewicht
  totalWeight: number;       // Gesamtgewicht (Spule + Filament) in g
  spoolWeight: number;       // Leergewicht der Spule in g
  length: number;            // in meters
  diameter: number;          // in mm
  diameterTolerance: number;
  standardDeviation: number; // in µm
  ovality: number;           // in %

  // Verwaltung / Sonstiges
  price: number;
  spoolSize: number;         // Filamentgewicht (Netto) bei Kauf in g
  spoolLength: number;       // Meter die beim Kauf der Spule auf der Spule sind.
  techSheetUrl: string;
  madeIn: string;
  extruderTemp: string;      // e.g., "240-260 C"
  heatbedTemp: string;       // e.g., "70-90 C"
  barcode: string;
  assignedPrinterId?: string; // ID of the printer it's on

  // Lager
  locationPath: string; // e.g. "Regal 1/Fach A/Box 3"

  // Bemerkung
  notes: string;
}

interface StorageNode {
    name: string;
    path: string;
    children: StorageNode[];
}

interface ColorCodeInfo {
    manufacturerColor: string;
    colorHex: string;
    code: string;
}


// --- Helper Functions ---
const colorNameToHex = (color: string): string | null => {
    if (!color) return null;
    if (/^#[0-9A-F]{6}$/i.test(color)) return color;
    
    const tempEl = document.createElement("div");
    tempEl.style.color = color;
    document.body.appendChild(tempEl);
    const computedColor = window.getComputedStyle(tempEl).color;
    document.body.removeChild(tempEl);

    if (!computedColor || !computedColor.startsWith('rgb')) return null;

    const rgb = computedColor.match(/\d+/g)?.map(Number);
    if (!rgb || rgb.length < 3) return null;

    return "#" + rgb.slice(0, 3).map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
};

const DENSITIES: { [key: string]: number } = { // g/cm³
    'pla': 1.24, 'abs': 1.04, 'petg': 1.27, 'nylon': 1.15, 'tpu': 1.21, 'pc': 1.20, 'asa': 1.07, 'hips': 1.04,
};

const calculateLength = (filamentWeight: number, diameter: number, type: string): number => {
    if (!filamentWeight || filamentWeight <= 0 || !diameter) return 0;
    const typeKey = type.toLowerCase();
    const densityKey = Object.keys(DENSITIES).find(k => typeKey.includes(k));
    const density = densityKey ? DENSITIES[densityKey] : DENSITIES['pla'];

    const radiusInCm = diameter / 2 / 10;
    const areaInCm2 = Math.PI * (radiusInCm ** 2);
    const volumeInCm3 = filamentWeight / density;
    const lengthInCm = volumeInCm3 / areaInCm2;
    
    return lengthInCm / 100;
};

const generateNewIdAndUpdateCounters = (typeStr: string, mfgColorStr: string, currentCounters: any): { newId: string, updatedCounters: any } => {
    const type = (typeStr || 'UNK').toUpperCase().replace(/[^A-Z\d]/g, '').substring(0, 4);
    const mfgColor = mfgColorStr || 'Unknown';
    
    const countersCopy = JSON.parse(JSON.stringify(currentCounters));

    if (!countersCopy.colorMap) {
        countersCopy.colorMap = {};
        countersCopy.nextColorNum = 1;
    }
    if (!countersCopy.typeCounters) {
        countersCopy.typeCounters = {};
    }
    if (!countersCopy.typeCounters[type]) {
        countersCopy.typeCounters[type] = { nextSpoolNum: 1 };
    }

    if (!countersCopy.colorMap[mfgColor]) {
        countersCopy.colorMap[mfgColor] = (countersCopy.nextColorNum++).toString().padStart(3, '0');
    }

    const spoolNum = (countersCopy.typeCounters[type].nextSpoolNum++).toString().padStart(4, '0');
    const colorCode = countersCopy.colorMap[mfgColor];
    const newId = `${type}-${spoolNum}-${colorCode}`;
    
    return { newId, updatedCounters: countersCopy };
};

const generateQrCodeSvgPath = (content: string, size: number): string => {
    try {
        const qr = QRCode.create(content, { errorCorrectionLevel: 'H' });
        const modules = qr.modules;
        if (!modules) return '';
        const moduleCount = modules.size;
        const moduleSize = size / moduleCount;
        let pathData = '';
        modules.data.forEach((isDark, i) => {
            if (isDark) {
                const y = Math.floor(i / moduleCount);
                const x = i % moduleCount;
                pathData += `M${x * moduleSize},${y * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
            }
        });
        return pathData;
    } catch (err) {
        console.error('Failed to generate QR code path:', err);
        return '';
    }
};

const migrateData = (data: any): {filaments: Filament[], storageTree: StorageNode[], idCounters: any, printers: Printer[]} => {
    const rawFilaments = data.filaments || [];
    const storageTree = data.storageTree || [];
    let idCounters = data.idCounters || {};
    let printers = data.printers || [];
    const dataVersion = data?.idCounters?.version || 1;

    // --- Printer Migration ---
    printers = printers.map((p: any) => ({
        ...p,
        id: p.id || crypto.randomUUID(),
        filamentDiameter: p.filamentDiameter ?? 1.75,
    }));

    // --- Legacy Filament Migration (location, spoolLength etc.)
    const needsLegacyMigration = rawFilaments.length > 0 && rawFilaments.some((f: any) => f.locationPath === undefined || f.spoolLength === undefined);
    let legacyMigratedFilaments = rawFilaments;
    if (needsLegacyMigration) {
        console.log("Migrating legacy filament data structure...");
        legacyMigratedFilaments = rawFilaments.map((f: any) => {
            const newF = { ...f };
            if (newF.netWeight !== undefined) {
                newF.spoolSize = newF.netWeight;
                newF.totalWeight = newF.totalWeight ?? (newF.netWeight + newF.spoolWeight);
                delete newF.netWeight;
            }
            if (newF.spoolLength === undefined) {
                const length = calculateLength(newF.spoolSize || 1000, newF.diameter || 1.75, newF.type || 'pla');
                newF.spoolLength = parseFloat(length.toFixed(2));
            }
            if (newF.locationPath === undefined) {
                newF.locationPath = [f.storageLocation, f.storageZone, f.storagePosition].filter(Boolean).join(' / ');
                delete newF.storageLocation;
                delete newF.storageZone;
                delete newF.storagePosition;
            }
            return newF as Filament;
        });
    }

    // --- ID System Migration (V3 - CCC based on ManufacturerColor only)
    let finalFilaments = legacyMigratedFilaments;
    if (dataVersion < 3 && finalFilaments.length > 0) {
        console.log("Migrating filament IDs to new unique format (V3)...");
        const newCounters: any = { colorMap: {}, nextColorNum: 1, typeCounters: {} };
        const sortedFilaments = [...finalFilaments].sort((a,b) => (a.madeDate || '').localeCompare(b.madeDate || '') || (a.id || '').localeCompare(b.id || ''));

        finalFilaments = sortedFilaments.map((f: Filament) => {
             const { newId, updatedCounters } = generateNewIdAndUpdateCounters(f.type, f.manufacturerColor, newCounters);
             Object.assign(newCounters, updatedCounters);
             return { ...f, id: newId };
        });
        idCounters = newCounters;
    } else if (Object.keys(idCounters).length === 0 && finalFilaments.length > 0) {
        console.log("Generating ID counters from existing V3 data...");
        const newCounters: any = { colorMap: {}, nextColorNum: 1, typeCounters: {} };
        finalFilaments.forEach((f: Filament) => {
             const [type, spoolNumStr, colorCode] = f.id.split('-');
             if(!type || !spoolNumStr || !colorCode) return;

             if (!newCounters.typeCounters[type]) newCounters.typeCounters[type] = { nextSpoolNum: 1 };
             const spoolNum = parseInt(spoolNumStr);
             newCounters.typeCounters[type].nextSpoolNum = Math.max(newCounters.typeCounters[type].nextSpoolNum, spoolNum + 1);
             
             const mfgColor = f.manufacturerColor || 'Unknown';
             if (!newCounters.colorMap[mfgColor]) {
                newCounters.colorMap[mfgColor] = colorCode;
                const colorNum = parseInt(colorCode);
                newCounters.nextColorNum = Math.max(newCounters.nextColorNum, colorNum + 1);
             }
        });
        idCounters = newCounters;
    }
    
    idCounters.version = 3;
    
    return { filaments: finalFilaments, storageTree, idCounters, printers };
};


// --- Components ---
const BarcodeScanner: React.FC<{ onScan: (barcode: string) => void; onClose: () => void; }> = ({ onScan, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const codeReaderRef = useRef(new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]])));

    useEffect(() => {
        const codeReader = codeReaderRef.current;
        const startScan = async () => {
            if (!videoRef.current) return;
            try {
                await codeReader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
                    if (result) {
                        onScan(result.getText());
                        onClose();
                    }
                    if (err && !(err instanceof NotFoundException)) {
                        console.error('Barcode detection failed', err);
                    }
                });
            } catch (err) {
                console.error(err);
                if (err instanceof Error) {
                     if (err.name === 'NotAllowedError') setError('Camera permission denied. Please grant permission in your browser settings.');
                     else if (err.name === "NotFoundError" || err.message.includes('Could not find any video input devices')) setError("No camera found. Please connect a camera and grant access.");
                     else setError('Could not access the camera. It might be in use by another application.');
                 } else setError('An unknown error occurred while initializing the scanner.');
            }
        };
        startScan();
        return () => {
            codeReader.reset();
        };
    }, [onScan, onClose]);

    return (
        <div className="scanner-container">
            <video ref={videoRef} className="scanner-video" playsInline />
            <div className="scanner-instructions">Positionieren Sie den QR-Code im Rahmen</div>
            <div className="viewfinder"><div className="scanning-laser"></div></div>
            {error && <p className="error">{error}</p>}
            <button onClick={onClose} className="button close-scanner-button">Scanner Schliessen</button>
        </div>
    );
};

const FilamentForm: React.FC<{ 
    onSave: (filament: Omit<Filament, 'id'> & { id?: string }) => void;
    onCancel: () => void; 
    initialData: Partial<Filament> | null;
    isEditing: boolean;
    storageLocations: string[];
    printers: Printer[];
    filaments: Filament[];
}> = ({ onSave, onCancel, initialData, isEditing, storageLocations, printers, filaments }) => {
    const [status, setStatus] = useState<'Originalverpackt' | 'Angebrochen' | 'Auf Drucker'>(initialData?.status || 'Originalverpackt');
    const [assignedPrinterId, setAssignedPrinterId] = useState(initialData?.assignedPrinterId || '');
    const [manufacturer, setManufacturer] = useState(initialData?.manufacturer || '');
    const [manufacturerColor, setManufacturerColor] = useState(initialData?.manufacturerColor || '');
    const [type, setType] = useState(initialData?.type || '');
    const [color, setColor] = useState(initialData?.color || '');
    const [colorHex, setColorHex] = useState(initialData?.colorHex ||'#CCCCCC');
    const [madeDate, setMadeDate] = useState(initialData?.madeDate || '');
    const [techSheetUrl, setTechSheetUrl] = useState(initialData?.techSheetUrl || '');
    const [madeIn, setMadeIn] = useState(initialData?.madeIn || '');
    const [extruderTemp, setExtruderTemp] = useState(initialData?.extruderTemp || '');
    const [heatbedTemp, setHeatbedTemp] = useState(initialData?.heatbedTemp || '');
    const [barcode, setBarcode] = useState(initialData?.barcode || '');
    const [locationPath, setLocationPath] = useState(initialData?.locationPath || '');
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [isScanning, setIsScanning] = useState(false);

    const [totalWeight, setTotalWeight] = useState<string>(initialData?.totalWeight?.toString() ?? '');
    const [spoolWeight, setSpoolWeight] = useState<string>(initialData?.spoolWeight?.toString() ?? '193');
    const [spoolSize, setSpoolSize] = useState<string>(initialData?.spoolSize?.toString() ?? '1000');
    const [spoolLength, setSpoolLength] = useState<string>(initialData?.spoolLength?.toString() ?? '');
    const [length, setLength] = useState<string>(initialData?.length?.toString() ?? '');
    const [diameter, setDiameter] = useState<string>(initialData?.diameter?.toString() ?? '1.75');
    const [diameterTolerance, setDiameterTolerance] = useState<string>(initialData?.diameterTolerance?.toString() ?? '0.02');
    const [price, setPrice] = useState<string>(initialData?.price?.toString() ?? '29.99');
    const [standardDeviation, setStandardDeviation] = useState<string>(initialData?.standardDeviation?.toString() ?? '');
    const [ovality, setOvality] = useState<string>(initialData?.ovality?.toString() ?? '');

    const filamentWeight = useMemo(() => {
        const totalW = parseFloat(totalWeight) || 0;
        const spoolW = parseFloat(spoolWeight) || 0;
        return Math.max(0, totalW - spoolW);
    }, [totalWeight, spoolWeight]);

    const availablePrinters = useMemo(() => {
        const usedPrinterIds = filaments
            .filter(f => f.id !== initialData?.id && f.assignedPrinterId)
            .map(f => f.assignedPrinterId!);
        return printers.filter(p => !usedPrinterIds.includes(p.id));
    }, [filaments, printers, initialData]);

    const handleColorTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newColorName = e.target.value;
        setColor(newColorName);
        const hex = colorNameToHex(newColorName);
        if (hex) setColorHex(hex);
    };
    
    const handleColorHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newHex = e.target.value;
        setColorHex(newHex);
        try { setColor(namer(newHex).ntc[0].name); } catch { setColor(newHex); }
    };
    
    const handleCalculateLength = () => {
        const calculated = calculateLength(filamentWeight, parseFloat(diameter), type);
        setLength(calculated > 0 ? calculated.toFixed(2) : '0');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const filamentData: Omit<Filament, 'id'> = {
            status, manufacturer, manufacturerColor, type, color: color || colorHex, colorHex, madeDate, 
            totalWeight: parseFloat(totalWeight) || 0,
            spoolWeight: parseFloat(spoolWeight) || 0,
            length: parseFloat(length) || 0,
            diameter: parseFloat(diameter) || 0,
            diameterTolerance: parseFloat(diameterTolerance) || 0,
            price: parseFloat(price) || 0,
            spoolSize: parseFloat(spoolSize) || 0,
            spoolLength: parseFloat(spoolLength) || 0,
            techSheetUrl, standardDeviation: parseFloat(standardDeviation) || 0, ovality: parseFloat(ovality) || 0,
            madeIn, extruderTemp, heatbedTemp, barcode, locationPath, notes,
            assignedPrinterId: status === 'Auf Drucker' ? assignedPrinterId : undefined
        };
        
        const saveData: Omit<Filament, 'id'> & { id?: string } = { ...filamentData };
        if (isEditing && initialData?.id) {
            saveData.id = initialData.id;
        }
        onSave(saveData);
    };

    const handleScan = (scannedBarcode: string) => {
        setBarcode(scannedBarcode);
        try { new URL(scannedBarcode); setTechSheetUrl(scannedBarcode); } catch (_) { /* Do nothing */ }
        setIsScanning(false);
    };

    return (
        <>
            {isScanning && <BarcodeScanner onScan={handleScan} onClose={() => setIsScanning(false)} />}
            <form onSubmit={handleSubmit} className="form-container">
                <h2>{isEditing ? 'Spulen-Datenblatt Bearbeiten' : 'Neue Spule Hinzufügen'}</h2>

                <fieldset>
                    <legend>Basis</legend>
                    <div className="form-row">
                        <div className="form-group"><label htmlFor="manufacturer">Hersteller</label><input id="manufacturer" type="text" value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="z.B. Prusament" required /></div>
                        <div className="form-group"><label htmlFor="type">Typ</label><input id="type" type="text" value={type} onChange={e => setType(e.target.value)} placeholder="z.B. PLA" required /></div>
                    </div>
                     <div className="form-row">
                         <div className="form-group"><label htmlFor="manufacturerColor">Hersteller-Farbe</label><input id="manufacturerColor" type="text" value={manufacturerColor} onChange={e => setManufacturerColor(e.target.value)} placeholder="z.B. Galaxy Black" required /></div>
                        <div className="form-group"><label htmlFor="status">Status</label><select id="status" value={status} onChange={e => setStatus(e.target.value as any)}><option value="Originalverpackt">Originalverpackt</option><option value="Angebrochen">Angebrochen</option><option value="Auf Drucker">Auf Drucker</option></select></div>
                     </div>
                     {status === 'Auf Drucker' && (
                        <div className="form-row">
                             <div className="form-group">
                                <label htmlFor="assignedPrinter">Drucker</label>
                                <select id="assignedPrinter" value={assignedPrinterId} onChange={e => setAssignedPrinterId(e.target.value)} required>
                                    <option value="" disabled>Drucker auswählen...</option>
                                    {initialData?.assignedPrinterId && !availablePrinters.some(p => p.id === initialData.assignedPrinterId) && 
                                        (() => {
                                            const currentPrinter = printers.find(p => p.id === initialData.assignedPrinterId);
                                            return currentPrinter ? <option key={currentPrinter.id} value={currentPrinter.id}>{currentPrinter.name} (aktuell)</option> : null;
                                        })()
                                    }
                                    {availablePrinters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                             </div>
                        </div>
                     )}
                      <div className="form-row form-row-3">
                        <div className="form-group"><label htmlFor="color">Ähnlichste Farbe & Farbton</label><div className="color-input-group"><input id="color" type="text" value={color} onChange={handleColorTextChange} placeholder="z.B. Black" /><input type="color" value={colorHex} onChange={handleColorHexChange} title="Farbton auswählen" /></div></div>
                        <div className="form-group"><label htmlFor="madeDate">Herstellungsdatum</label><input id="madeDate" type="text" value={madeDate} onChange={e => setMadeDate(e.target.value)} placeholder="z.B. 2.5.2023 17:34" /></div>
                     </div>
                </fieldset>

                <fieldset>
                    <legend>Abmessungen</legend>
                     <div className="form-row form-row-4">
                        <div className="form-group"><label htmlFor="totalWeight">Gewicht (Spule+Filament)</label><input id="totalWeight" type="number" step="any" value={totalWeight} onChange={e => setTotalWeight(e.target.value)} placeholder="Auf der Waage" /></div>
                        <div className="form-group"><label htmlFor="spoolWeight">Spulengewicht (g)</label><input id="spoolWeight" type="number" step="any" value={spoolWeight} onChange={e => setSpoolWeight(e.target.value)} placeholder="Leergewicht"/></div>
                        <div className="form-group"><label htmlFor="filamentWeight">Filamentgewicht (g)</label><input id="filamentWeight" type="number" value={filamentWeight.toFixed(2)} readOnly /></div>
                        <div className="form-group"><label htmlFor="length">Länge (m)</label><div className="input-with-button"><input id="length" type="number" step="any" value={length} onChange={e => setLength(e.target.value)} /><button type="button" onClick={handleCalculateLength} title="Länge aus Gewicht und Durchmesser berechnen" className="button button-icon" disabled={!filamentWeight || !diameter}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div></div>
                     </div>
                     <div className="form-row">
                         <div className="form-group"><label htmlFor="diameter">Durchmesser (mm)</label><input id="diameter" type="number" step="0.01" value={diameter} onChange={e => setDiameter(e.target.value)} /></div>
                        <div className="form-group"><label htmlFor="diameterTolerance">Toleranz (±mm)</label><input id="diameterTolerance" type="number" step="0.001" value={diameterTolerance} onChange={e => setDiameterTolerance(e.target.value)} /></div>
                     </div>
                      <div className="form-row">
                        <div className="form-group"><label htmlFor="standardDeviation">Standardabweichung (µm)</label><input id="standardDeviation" type="number" step="any" value={standardDeviation} onChange={e => setStandardDeviation(e.target.value)} /></div>
                        <div className="form-group"><label htmlFor="ovality">Ovalität (%)</label><input id="ovality" type="number" step="any" value={ovality} onChange={e => setOvality(e.target.value)} /></div>
                     </div>
                     <div className="form-row">
                        <div className="form-group"><label htmlFor="extruderTemp">Extruder Temp. (°C)</label><input id="extruderTemp" type="text" value={extruderTemp} onChange={e => setExtruderTemp(e.target.value)} placeholder="z.B. 240-260" /></div>
                        <div className="form-group"><label htmlFor="heatbedTemp">Heizbett Temp. (°C)</label><input id="heatbedTemp" type="text" value={heatbedTemp} onChange={e => setHeatbedTemp(e.target.value)} placeholder="z.B. 70-90" /></div>
                     </div>
                </fieldset>
                
                <fieldset>
                    <legend>Verwaltung & Lager</legend>
                     <div className="form-row form-row-4">
                        <div className="form-group"><label htmlFor="price">Preis/Spule (€)</label><input id="price" type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
                        <div className="form-group"><label htmlFor="spoolSize">Spulengröße (g)</label><input id="spoolSize" type="number" step="any" value={spoolSize} onChange={e => setSpoolSize(e.target.value)} placeholder="Netto bei Kauf"/></div>
                        <div className="form-group"><label htmlFor="spoolLength">Spulenmeter (m)</label><input id="spoolLength" type="number" step="any" value={spoolLength} onChange={e => setSpoolLength(e.target.value)} placeholder="Länge bei Kauf"/></div>
                        <div className="form-group"><label htmlFor="madeIn">Hergestellt in</label><input id="madeIn" type="text" value={madeIn} onChange={e => setMadeIn(e.target.value)} placeholder="z.B. CZ" /></div>
                     </div>
                     <div className="form-row">
                        <div className="form-group">
                           <label htmlFor="locationPath">Lagerplatz</label>
                           <select id="locationPath" value={locationPath} onChange={e => setLocationPath(e.target.value)}>
                                <option value="">Kein Lagerplatz</option>
                                {storageLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                           </select>
                        </div>
                     </div>
                     <div className="form-group">
                        <label htmlFor="techSheetUrl">Datenblatt-Link / QR-Code</label>
                        <div className="input-with-button">
                             <input id="techSheetUrl" type="url" value={techSheetUrl} onChange={e => setTechSheetUrl(e.target.value)} placeholder="URL eingeben oder QR-Code scannen..." />
                             <button type="button" className="button button-icon" onClick={() => techSheetUrl && window.open(techSheetUrl, '_blank')} disabled={!techSheetUrl} title="Link in neuem Tab öffnen"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></button>
                             <button type="button" className="button button-icon" onClick={() => setIsScanning(true)} title="Barcode-Scanner öffnen"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg></button>
                        </div>
                     </div>
                </fieldset>

                <fieldset>
                    <legend>Bemerkung</legend>
                    <div className="form-group"><textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Notizen zur Spule..."></textarea></div>
                </fieldset>
                
                <div className="form-actions">
                    <button type="button" className="button button-secondary" onClick={onCancel}>Abbrechen</button>
                    <button type="submit" className="button">{isEditing ? 'Speichern' : 'Hinzufügen'}</button>
                </div>
            </form>
        </>
    );
};

const RemainingFilamentVisualizer: React.FC<{ percentage: number; color: string; }> = ({ percentage, color }) => {
    const size = 24;
    const strokeWidth = 3;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (percentage / 100) * circumference;

    return (
        <svg className="percentage-circle" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle className="bg" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
            <circle className="progress" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                stroke={color}
            />
        </svg>
    );
};

const FilamentMatrixCard: React.FC<{ filament: Filament; printers: Printer[]; onClick: () => void; onUpdateWeight: (id: string, weight: number) => void; }> = ({ filament, printers, onClick, onUpdateWeight }) => {
    const filamentWeight = filament.totalWeight - filament.spoolWeight;
    const percentage = filament.spoolSize > 0 ? Math.max(0, Math.min(100, (filamentWeight / filament.spoolSize) * 100)) : 0;
    const [quickWeight, setQuickWeight] = useState(filament.totalWeight.toString());
    const inputRef = useRef<HTMLInputElement>(null);

    const assignedPrinterName = useMemo(() => {
        if (filament.status !== 'Auf Drucker' || !filament.assignedPrinterId) return null;
        return printers.find(p => p.id === filament.assignedPrinterId)?.name || 'Unbekannter Drucker';
    }, [filament, printers]);

    useEffect(() => {
        setQuickWeight(filament.totalWeight.toString());
    }, [filament.totalWeight]);

    const handleQuickWeightSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const weightValue = parseFloat(quickWeight);
        if (!isNaN(weightValue) && weightValue >= filament.spoolWeight) {
            onUpdateWeight(filament.id, weightValue);
        } else {
            alert(`Ungültiges Gewicht. Muss eine Zahl sein und größer als das Spulengewicht (${filament.spoolWeight}g).`);
            setQuickWeight(filament.totalWeight.toString());
        }
    };

    return (
        <div className="matrix-card" onClick={onClick} style={{ borderLeftColor: filament.colorHex || filament.color }}>
            <div className="matrix-card-content">
                <div className="matrix-card-top">
                    <span className="matrix-card-type">{filament.type}</span>
                    <div className="filament-percentage-indicator" title={`${filamentWeight.toFixed(1)}g / ${filament.spoolSize}g`}>
                        <RemainingFilamentVisualizer percentage={percentage} color={filament.colorHex || filament.color} />
                        <span>{percentage.toFixed(0)}%</span>
                    </div>
                </div>
                <div className="matrix-card-info">
                    <span className="matrix-card-color">{filament.manufacturerColor || filament.color}</span>
                     {filament.status === 'Auf Drucker' && assignedPrinterName ? (
                        <span className="matrix-card-status on-printer" title={`Auf Drucker: ${assignedPrinterName}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                            {assignedPrinterName}
                        </span>
                    ) : (
                        <span className="matrix-card-location">{filament.locationPath || 'Nicht eingelagert'}</span>
                    )}
                </div>
            </div>
            <form className="matrix-card-quick-edit" onSubmit={handleQuickWeightSubmit}>
                <label htmlFor={`quick-weight-${filament.id}`} title="Aktuelles Gesamtgewicht (Spule + Filament)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3C7.03 3 3 7.03 3 12c0 1.62.43 3.14 1.2 4.5L8 12V8c0-2.21 1.79-4 4-4 1.47 0 2.75.8 3.44 2H18.8c-.56-2.9-3.2-5-6.44-5z"/><path d="M12 21c-1.68 0-3.23-.46-4.59-1.25L16 12v4c0 2.21-1.79 4-4 4zm4-13h-2.12c-.56-2.9-3.2-5-6.44-5C7.03 3 3 7.03 3 12c0 1.62.43 3.14 1.2 4.5L8 12V8c0-2.21 1.79-4 4-4 1.47 0 2.75.8 3.44 2z"/></svg>
                </label>
                <input
                    ref={inputRef}
                    id={`quick-weight-${filament.id}`}
                    type="number"
                    step="any"
                    value={quickWeight}
                    onChange={e => { e.stopPropagation(); setQuickWeight(e.target.value); }}
                    onClick={e => e.stopPropagation()}
                />
                <span>g</span>
                <button type="submit" className="button button-icon button-small" onClick={e => e.stopPropagation()} title="Gewicht speichern">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </button>
            </form>
        </div>
    );
};

const FilamentMatrixView: React.FC<{
    filaments: Filament[];
    printers: Printer[];
    totalCount: number;
    onViewDetail: (id: string) => void;
    onUpdateWeight: (id: string, weight: number) => void;
}> = ({ filaments, printers, totalCount, onViewDetail, onUpdateWeight }) => {
    if (totalCount === 0) {
        return <div className="empty-state"><h3>Keine Spulen gefunden</h3><p>Fügen Sie Ihre erste Spule hinzu, um zu beginnen.</p></div>;
    }
    if (filaments.length === 0) {
        return <div className="empty-state"><h3>Keine passenden Spulen</h3><p>Es wurden keine Spulen gefunden, die den aktuellen Filtereinstellungen entsprechen.</p></div>;
    }
    return (
        <div className="matrix-view">
            <div className="matrix-header"><p>Angezeigte Spulen: {filaments.length} / {totalCount}</p></div>
            <div className="matrix-grid">
                {filaments.map(filament => <FilamentMatrixCard key={filament.id} filament={filament} printers={printers} onClick={() => onViewDetail(filament.id)} onUpdateWeight={onUpdateWeight} />)}
            </div>
        </div>
    );
};

const DataPair: React.FC<{ label: string; value: React.ReactNode; unit?: string; }> = ({ label, value, unit }) => {
    if (value === null || value === undefined || value === '' || (typeof value === 'number' && isNaN(value))) return null;
    return (
        <div className="data-pair">
            <dt>{label}</dt>
            <dd>{value}{unit && ` ${unit}`}</dd>
        </div>
    );
};

const FilamentDetailView: React.FC<{ 
    filament: Filament;
    printers: Printer[];
    onDelete: (id: string) => void; 
    onEdit: (id: string) => void;
    onCopy: (id: string) => void;
    onPrint: (id: string) => void;
    onSelectLocation: (path: string) => void;
}> = ({ filament, printers, onDelete, onEdit, onCopy, onPrint, onSelectLocation }) => {
    const currentFilamentWeight = useMemo(() => Math.max(0, filament.totalWeight - filament.spoolWeight), [filament.totalWeight, filament.spoolWeight]);
    const wikipediaUrl = `https://de.wikipedia.org/wiki/${encodeURIComponent(filament.type)}`;
    const assignedPrinterName = useMemo(() => {
        if (filament.status !== 'Auf Drucker' || !filament.assignedPrinterId) return null;
        return printers.find(p => p.id === filament.assignedPrinterId)?.name || 'Unbekannter Drucker';
    }, [filament, printers]);

    return (
        <div className="detail-view-container">
            <div className="filament-datasheet">
                <div className="datasheet-header">
                    <div><h3>{`${filament.manufacturer} ${filament.type}`}</h3><h4 className="datasheet-color-name">{filament.manufacturerColor}</h4></div>
                    <div className="color-dot" style={{ backgroundColor: filament.colorHex || filament.color }}></div>
                </div>
                <div className="datasheet-section"><h4>Basis</h4><dl className="datasheet-list">
                    <DataPair label="Hersteller" value={filament.manufacturer} />
                    <DataPair label="Typ" value={<a href={wikipediaUrl} target="_blank" rel="noopener noreferrer">{filament.type}</a>} />
                    <DataPair label="Hersteller-Farbe" value={filament.manufacturerColor} />
                    <DataPair label="Status" value={filament.status === 'Auf Drucker' ? `Auf Drucker (${assignedPrinterName})` : filament.status} />
                    <DataPair label="Ähnlichste Farbe" value={filament.color} />
                    <DataPair label="Farb-Code (Hex)" value={filament.colorHex} />
                    <DataPair label="Herstellungsdatum" value={filament.madeDate} />
                </dl></div>
                <div className="datasheet-section"><h4>Abmessungen</h4><dl className="datasheet-list">
                    <DataPair label="Gewicht (Spule+Filament)" value={filament.totalWeight.toFixed(2)} unit="g" />
                    <DataPair label="Spulengewicht" value={filament.spoolWeight.toFixed(2)} unit="g" />
                    <DataPair label="Filamentgewicht" value={currentFilamentWeight.toFixed(2)} unit="g" />
                    <DataPair label="Länge" value={filament.length.toFixed(2)} unit="m" />
                    <DataPair label="Ø" value={filament.diameter.toFixed(2)} unit={`mm (±${filament.diameterTolerance})`} />
                    <DataPair label="Standardabw." value={filament.standardDeviation} unit="µm" />
                    <DataPair label="Ovalität" value={filament.ovality} unit="%" />
                    <DataPair label="Extruder" value={filament.extruderTemp} unit="°C" />
                    <DataPair label="Heizbett" value={filament.heatbedTemp} unit="°C" />
                </dl></div>
                <div className="datasheet-section"><h4>Verwaltung & Lager</h4><dl className="datasheet-list">
                    <DataPair label="Interne ID" value={filament.id} />
                    <DataPair label="Preis/Spule" value={filament.price.toFixed(2)} unit="€" />
                    <DataPair label="Spulengröße" value={filament.spoolSize} unit="g" />
                    <DataPair label="Spulenmeter" value={filament.spoolLength.toFixed(2)} unit="m" />
                    <DataPair label="Hergestellt in" value={filament.madeIn} />
                    <DataPair label="Lagerort" value={filament.locationPath ? <a href="#" onClick={(e) => { e.preventDefault(); onSelectLocation(filament.locationPath); }}>{filament.locationPath}</a> : 'Nicht eingelagert'} />
                    {filament.techSheetUrl && <DataPair label="Datenblatt" value={<a href={filament.techSheetUrl} target="_blank" rel="noopener noreferrer">Öffnen</a>} />}
                    {filament.barcode && <DataPair label="Hersteller-Barcode" value={filament.barcode} />}
                    <DataPair label="Interner QR-Code" value={<a href="#" onClick={(e) => { e.preventDefault(); onPrint(filament.id)}}>Etikett anzeigen / drucken</a>} />
                </dl></div>
                {filament.notes && (<div className="datasheet-section"><h4>Bemerkung</h4><p className="notes-content">{filament.notes}</p></div>)}
                <div className="card-footer"><button onClick={() => onPrint(filament.id)} className="button button-secondary button-small">Drucken</button><button onClick={() => onCopy(filament.id)} className="button button-secondary button-small">Kopieren</button><button onClick={() => onEdit(filament.id)} className="button button-secondary button-small">Bearbeiten</button><button onClick={() => onDelete(filament.id)} className="button button-danger button-small">Löschen</button></div>
            </div>
        </div>
    );
};

const PrintLabelView: React.FC<{ filament: Filament; onClose: () => void; }> = ({ filament, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);

    const svgFilename = useMemo(() => `${(filament.type || '').replace(/[\/\\?%*:|"<>&]/g, '_')}_${(filament.manufacturer || '').replace(/[\/\\?%*:|"<>&]/g, '_')}_${(filament.manufacturerColor || '').replace(/[\/\\?%*:|"<>&]/g, '_')}.svg`, [filament]);

    const generateSvg = useCallback(() => {
        try {
            const qrContent = `FMT_SPOOL::${filament.id}`;
            const qrSize = 25; // mm
            const qrPath = generateQrCodeSvgPath(qrContent, qrSize);

            const escape = (s: string|null|undefined) => (s||'').replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c] || c));
            
            const wrap = (text: string, maxWidth: number, fontSize: number): string[] => {
                const avgCharWidth = fontSize * 0.55; 
                const maxChars = Math.floor(maxWidth / avgCharWidth);
                if (!text || text.length <= maxChars) return [text || ''];
                const words = text.split(/\s+/);
                const lines: string[] = [];
                let currentLine = words.shift() || '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).length > maxChars && currentLine.length > 0) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine += ' ' + word;
                    }
                }
                lines.push(currentLine);
                return lines.slice(0, 2);
            }

            const bodyFontSize = 3.5;
            const locationLines = wrap(filament.locationPath, 40, bodyFontSize);
            const locationTSpans = locationLines.map((line, i) => `<tspan x="18" dy="${i === 0 ? 0 : '1.2em'}">${escape(line)}</tspan>`).join('');

            const svgContent = `
<svg width="70mm" height="37mm" viewBox="0 0 70 37" xmlns="http://www.w3.org/2000/svg">
<defs>
    <clipPath id="mfgColorClip">
        <rect x="57" y="0" width="11" height="10" />
    </clipPath>
</defs>
<style>
    .type { font-size: 4.5px; font-weight: bold; }
    .mfg { font-size: 3.5px; }
    .mfg-color { font-size: 4px; text-anchor: start; }
    .body-text { font-size: 3.5px; }
    .body-bold { font-weight: bold; }
</style>
<rect width="100%" height="100%" fill="white" />
<text x="3" y="6" class="type">${escape(filament.type)}</text>
<text x="3" y="10" class="mfg">${escape(filament.manufacturer)}</text>
<circle cx="53" cy="6" r="2.5" fill="${escape(filament.colorHex)}" stroke="black" stroke-width="0.3" />
<text x="57" y="7.5" class="mfg-color" clip-path="url(#mfgColorClip)">${escape(filament.manufacturerColor)}</text>
<line x1="2" y1="13" x2="68" y2="13" stroke="black" stroke-width="0.3" />
<text x="3" y="18" class="body-text"><tspan class="body-bold">Extruder:</tspan> ${escape(filament.extruderTemp)} °C</text>
<text x="3" y="23" class="body-text"><tspan class="body-bold">Heizbett:</tspan> ${escape(filament.heatbedTemp)} °C</text>
<text x="3" y="28" class="body-text">
    <tspan class="body-bold">Lagerort:</tspan>
    ${locationTSpans}
</text>
<g transform="translate(${70 - qrSize - 2}, ${(37 - qrSize) / 2}) scale(1, -1) translate(0, -${qrSize})">
    <path d="${qrPath}" fill="black" stroke="none" transform="scale(1, -1) translate(0, -${qrSize})"/>
</g>
</svg>`.trim().replace(/>\s+</g, '><');

            setSvgDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`);
        } catch (err) {
            console.error("QR/SVG Error:", err);
        }
    }, [filament]);

    useEffect(() => {
        generateSvg();
        QRCode.toCanvas(canvasRef.current, `FMT_SPOOL::${filament.id}`, { errorCorrectionLevel: 'H', width: 90, margin: 1 }, (error) => {
            if (error) console.error(error);
        });
    }, [filament, generateSvg]);

    return (
        <div className="print-preview-modal" onClick={onClose}>
            <div className="print-preview-content" onClick={e => e.stopPropagation()}>
                <div className="printable-area">
                    <h3 className="no-print">Etikett-Vorschau</h3>
                    <div className="label-to-print-container">
                        <div className="label-to-print">
                            <div className="label-header"><div className="label-header-left" title={`${filament.type} (${filament.manufacturer})`}><h4>{filament.type}</h4><span className="manufacturer-name">{filament.manufacturer}</span></div><div className="label-header-right" title={filament.manufacturerColor}><div className="color-indicator" style={{ backgroundColor: filament.colorHex || filament.color }}></div><span>{filament.manufacturerColor}</span></div></div>
                            <div className="label-body"><div className="label-info"><p><strong>Extruder:</strong> {filament.extruderTemp} °C</p><p><strong>Heizbett:</strong> {filament.heatbedTemp} °C</p><p className="storage-location"><strong>Lagerort:</strong> {filament.locationPath}</p></div><div className="label-qr"><canvas ref={canvasRef}></canvas></div></div>
                        </div>
                    </div>
                </div>
                <div className="print-actions no-print"><button className="button button-secondary button-small" onClick={onClose}>Schließen</button><a href={svgDataUrl!} download={svgFilename} className={`button button-secondary button-small ${!svgDataUrl ? 'disabled' : ''}`}>Als SVG Speichern</a><button className="button button-small" onClick={() => window.print()}>Jetzt Drucken</button></div>
            </div>
        </div>
    );
};

const LocationLabelPreview: React.FC<{ locationPath: string; onClose: () => void }> = ({ locationPath, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);
    const qrContent = `FMT_LOCATION::${locationPath}`;

    const generateSvg = useCallback(() => {
        try {
            const qrSize = 28; // mm
            const qrPath = generateQrCodeSvgPath(qrContent, qrSize);
            const escape = (s: string) => s.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c] || c));

            const wrap = (text: string, maxWidth: number, fontSize: number): string[] => {
                const avgCharWidth = fontSize * 0.6;
                const maxChars = Math.floor(maxWidth / avgCharWidth);
                const words = text.split(/\s+/);
                const lines: string[] = [];
                let currentLine = words.shift() || '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).length > maxChars && currentLine.length > 0) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine += ' ' + word;
                    }
                }
                lines.push(currentLine);
                return lines;
            }

            const titleFontSize = 4;
            const pathFontSize = 3.5;
            const pathLines = wrap(locationPath, 35, pathFontSize);
            const pathTSpans = pathLines.map((line, i) => `<tspan x="5" dy="${i === 0 ? 0 : '1.3em'}">${escape(line)}</tspan>`).join('');

            const svgContent = `
<svg width="70mm" height="37mm" viewBox="0 0 70 37" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="white" />
<rect x="2" y="2" width="66" height="33" fill="none" stroke="black" stroke-width="0.5" />
<text x="5" y="10" style="font-size: ${titleFontSize}px; font-weight: bold;">Lagerplatz:</text>
<text x="5" y="16" style="font-size: ${pathFontSize}px;">
    ${pathTSpans}
</text>
<g transform="translate(${70 - qrSize - 4}, ${(37 - qrSize) / 2})">
    <path d="${qrPath}" fill="black" stroke="none" />
</g>
</svg>`.trim().replace(/>\s+</g, '><');
            setSvgDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`);
        } catch (err) {
            console.error("QR/SVG Error:", err);
        }
    }, [locationPath, qrContent]);

    useEffect(() => {
        generateSvg();
        QRCode.toCanvas(canvasRef.current, qrContent, { errorCorrectionLevel: 'H', width: 90, margin: 1 }, err => { if (err) console.error(err); });
    }, [locationPath, qrContent, generateSvg]);

    return (
        <div className="print-preview-modal" onClick={onClose}>
            <div className="print-preview-content" onClick={e => e.stopPropagation()}>
                 <div className="printable-area">
                    <h3 className="no-print">Lagerplatz-Etikett Vorschau</h3>
                    <div className="label-to-print-container">
                        <div className="label-to-print" style={{ justifyContent: 'center', alignItems: 'center', padding: '1mm' }}>
                            <div style={{ display: 'flex', alignItems: 'center', width: '100%', border: '1px solid black', height: '100%', padding: '1mm' }}>
                                <div style={{ flexGrow: 1, wordBreak: 'break-word', paddingRight: '2mm' }}><strong>Lagerplatz:</strong><br/>{locationPath}</div>
                                <div className="label-qr" style={{width: '28mm', height: '28mm'}}><canvas ref={canvasRef}></canvas></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="print-actions no-print"><button className="button button-secondary button-small" onClick={onClose}>Schließen</button><a href={svgDataUrl!} download={`lagerplatz_${locationPath.replace(/[\/\s]/g, '_')}.svg`} className={`button button-secondary button-small ${!svgDataUrl ? 'disabled' : ''}`}>Als SVG Speichern</a><button className="button button-small" onClick={() => window.print()}>Jetzt Drucken</button></div>
            </div>
        </div>
    );
};

const StorageTreeView: React.FC<{ tree: StorageNode[], selected: string, onSelect: (path: string) => void }> = ({ tree, selected, onSelect }) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (selected) {
            const newExpanded = new Set(expanded);
            const pathParts = selected.split(' / ');
            let currentPath = '';
            for (const part of pathParts) {
                currentPath = currentPath ? `${currentPath} / ${part}` : part;
                if (!newExpanded.has(currentPath)) {
                    newExpanded.add(currentPath);
                }
            }
            setExpanded(newExpanded);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);
    
    const toggleNode = (path: string) => {
        const newExpanded = new Set(expanded);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpanded(newExpanded);
    };

    const renderNode = (node: StorageNode, level: number) => {
        const isExpanded = expanded.has(node.path);
        const hasChildren = node.children && node.children.length > 0;
        return (
            <li key={node.path} className="tree-node">
                <div className="tree-node-label" style={{ paddingLeft: `${1 + level * 1.5}rem` }}>
                    {hasChildren && <button className={`tree-toggle ${isExpanded ? 'expanded' : ''}`} onClick={() => toggleNode(node.path)} />}
                    <a href="#" className={selected === node.path ? 'active' : ''} onClick={(e) => { e.preventDefault(); onSelect(node.path); }}>{node.name}</a>
                </div>
                {hasChildren && <ul className={`tree-node-children ${isExpanded ? 'expanded' : ''}`}>{node.children.map(child => renderNode(child, level + 1))}</ul>}
            </li>
        );
    };

    return (
        <nav className="storage-tree">
            <ul>
                <li className="tree-node">
                    <div className="tree-node-label" style={{ paddingLeft: `1rem` }}>
                        <a href="#" className={selected === '' ? 'active' : ''} onClick={(e) => { e.preventDefault(); onSelect(''); }}>Alle Spulen</a>
                    </div>
                </li>
                {tree.map(node => renderNode(node, 0))}
                <li className="tree-node">
                    <div className="tree-node-label" style={{ paddingLeft: `1rem` }}>
                        <a href="#" className={selected === '__UNSORTED__' ? 'active' : ''} onClick={(e) => { e.preventDefault(); onSelect('__UNSORTED__'); }}>Nicht eingelagert</a>
                    </div>
                </li>
            </ul>
        </nav>
    );
};

const StorageManager: React.FC<{ initialTree: StorageNode[], onSave: (tree: StorageNode[]) => void, onClose: () => void, onPrint: (path: string) => void }> = ({ initialTree, onSave, onClose, onPrint }) => {
    const [tree, setTree] = useState(initialTree);

    const handleAdd = (path: string) => {
        const name = prompt("Name des neuen Lagerorts:");
        if (!name) return;
        
        const newTree = JSON.parse(JSON.stringify(tree));
        const newNode: StorageNode = { name, path: path ? `${path} / ${name}` : name, children: [] };
        
        if (path === '') newTree.push(newNode);
        else {
            const findAndAdd = (nodes: StorageNode[]) => {
                for (const node of nodes) {
                    if (node.path === path) { node.children.push(newNode); return true; }
                    if (findAndAdd(node.children)) return true;
                }
                return false;
            };
            findAndAdd(newTree);
        }
        setTree(newTree);
    };

    const handleDelete = (path: string) => {
        if (!window.confirm(`Sicher, dass Sie "${path}" und alle Unterordner löschen möchten? Spulen an diesem Ort werden als "Nicht eingelagert" markiert.`)) return;
        
        const newTree = JSON.parse(JSON.stringify(tree));
        const findAndDelete = (nodes: StorageNode[], p: string): StorageNode[] => nodes.filter(node => node.path !== p).map(node => ({ ...node, children: findAndDelete(node.children, p) }));
        setTree(findAndDelete(newTree, path));
    };
    
    const handleRename = (path: string, oldName: string) => {
         const newName = prompt("Neuer Name:", oldName);
         if (!newName || newName === oldName) return;

         const newTree = JSON.parse(JSON.stringify(tree));
         const findAndRename = (nodes: StorageNode[], p: string) => {
             for (const node of nodes) {
                 if (node.path === p) {
                     const parentPath = p.includes(' / ') ? p.substring(0, p.lastIndexOf(' / ')) : '';
                     node.name = newName;
                     const oldPathPrefix = node.path;
                     node.path = parentPath ? `${parentPath} / ${newName}` : newName;

                     // Update children paths
                     const updateChildPaths = (children: StorageNode[], oldParentPath: string, newParentPath: string) => {
                         children.forEach(child => {
                             child.path = child.path.replace(new RegExp(`^${oldParentPath}`), newParentPath);
                             updateChildPaths(child.children, oldParentPath, newParentPath);
                         });
                     };
                     updateChildPaths(node.children, oldPathPrefix, node.path);
                     return true;
                 }
                 if (findAndRename(node.children, p)) return true;
             }
             return false;
         };
         findAndRename(newTree, path);
         setTree(newTree);
    };

    const renderNode = (node: StorageNode) => (
        <li key={node.path}>
            <div className="storage-manager-item">
                <span>{node.name}</span>
                <div className="item-actions">
                    <button onClick={() => onPrint(node.path)} title="Etikett drucken" className="button button-icon button-small">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    </button>
                    <button onClick={() => handleAdd(node.path)} title="Unterordner hinzufügen" className="button button-icon button-small">+</button>
                    <button onClick={() => handleRename(node.path, node.name)} title="Umbenennen" className="button button-icon button-small">✎</button>
                    <button onClick={() => handleDelete(node.path)} title="Löschen" className="button button-icon button-small button-danger">🗑</button>
                </div>
            </div>
            {node.children && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
        </li>
    );

    return (
        <div className="modal-overlay">
            <div className="storage-manager-container">
                <h2>Lagerverwaltung</h2>
                <div className="storage-manager-tree">
                    <ul>{tree.map(renderNode)}</ul>
                    <button onClick={() => handleAdd('')} className="button button-secondary">Neue Ebene hinzufügen</button>
                </div>
                <div className="form-actions">
                    <button onClick={onClose} className="button button-secondary">Abbrechen</button>
                    <button onClick={() => onSave(tree)} className="button">Speichern & Schließen</button>
                </div>
            </div>
        </div>
    );
};

const PrinterManager: React.FC<{ initialPrinters: Printer[], onSave: (printers: Printer[]) => void, onClose: () => void }> = ({ initialPrinters, onSave, onClose }) => {
    const [printers, setPrinters] = useState(initialPrinters);

    const handleAdd = () => {
        const newPrinter: Printer = {
            id: crypto.randomUUID(),
            name: 'Neuer Drucker',
            manufacturer: '',
            nozzle: '0.4mm',
            filamentDiameter: 1.75
        };
        setPrinters(prev => [...prev, newPrinter]);
    };

    const handleDelete = (id: string) => {
        if (!window.confirm(`Sind Sie sicher, dass Sie diesen Drucker löschen möchten? Eine auf diesem Drucker geladene Spule wird auf den Status "Angebrochen" zurückgesetzt.`)) return;
        setPrinters(prev => prev.filter(p => p.id !== id));
    };
    
    const handleUpdate = (id: string, field: keyof Omit<Printer, 'id'>, value: string) => {
         setPrinters(prev => prev.map(p => {
            if (p.id === id) {
                const updatedValue = field === 'filamentDiameter' ? parseFloat(value) || 0 : value;
                return { ...p, [field]: updatedValue };
            }
            return p;
        }));
    };

    return (
        <div className="modal-overlay">
            <div className="printer-manager-container">
                <h2>Druckerverwaltung</h2>
                <div className="printer-manager-list">
                    {printers.length > 0 ? (
                        <div className="printer-list-header">
                            <span>Name</span>
                            <span>Hersteller</span>
                            <span>Düse</span>
                            <span>Filamentdurchmesser (mm)</span>
                            <span>Aktionen</span>
                        </div>
                    ) : (
                         <div className="empty-state-small">Keine Drucker gefunden. Fügen Sie Ihren ersten Drucker hinzu.</div>
                    )}
                    {printers.map(printer => (
                        <div key={printer.id} className="printer-manager-item">
                            <div className="printer-input-group">
                                <label htmlFor={`printer-name-${printer.id}`}>Name</label>
                                <input id={`printer-name-${printer.id}`} type="text" value={printer.name} onChange={e => handleUpdate(printer.id, 'name', e.target.value)} placeholder="z.B. Ender 3 V2" />
                            </div>
                            <div className="printer-input-group">
                                <label htmlFor={`printer-manufacturer-${printer.id}`}>Hersteller</label>
                                <input id={`printer-manufacturer-${printer.id}`} type="text" value={printer.manufacturer} onChange={e => handleUpdate(printer.id, 'manufacturer', e.target.value)} placeholder="z.B. Creality" />
                            </div>
                            <div className="printer-input-group">
                                 <label htmlFor={`printer-nozzle-${printer.id}`}>Düse</label>
                                <input id={`printer-nozzle-${printer.id}`} type="text" value={printer.nozzle} onChange={e => handleUpdate(printer.id, 'nozzle', e.target.value)} placeholder="z.B. 0.4mm Brass" />
                            </div>
                            <div className="printer-input-group">
                                <label htmlFor={`printer-diameter-${printer.id}`}>Filamentdurchmesser (mm)</label>
                                <input id={`printer-diameter-${printer.id}`} type="number" step="0.01" value={printer.filamentDiameter} onChange={e => handleUpdate(printer.id, 'filamentDiameter', e.target.value)} placeholder="z.B. 1.75" />
                            </div>
                            <div className="item-actions">
                                <button onClick={() => handleDelete(printer.id)} title="Löschen" className="button button-icon button-small button-danger">🗑</button>
                            </div>
                        </div>
                    ))}
                </div>
                <button onClick={handleAdd} className="button button-secondary">Neuen Drucker hinzufügen</button>
                <div className="form-actions">
                    <button onClick={onClose} className="button button-secondary">Abbrechen</button>
                    <button onClick={() => onSave(printers)} className="button">Speichern & Schließen</button>
                </div>
            </div>
        </div>
    );
};

const UserGuide: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="guide-modal-container" onClick={(e) => e.stopPropagation()}>
                <h2>Bedienungsanleitung</h2>
                <div className="guide-content">
                    <section>
                        <h3>Erste Schritte</h3>
                        <p>Willkommen beim Filament Management Tool! Ihre Daten werden sicher in Ihrem Browser gespeichert. Es wird nichts an einen Server gesendet.</p>
                        <ul>
                            <li><strong>Neue Liste erstellen:</strong> Startet eine leere Datenbank für Ihre Spulen.</li>
                            <li><strong>Daten laden:</strong> Importiert eine zuvor gespeicherte <code>filament_data.json</code> Datei und ersetzt alle aktuellen Daten.</li>
                            <li><strong>Speichern:</strong> Lädt Ihre aktuelle Datenbank als <code>filament_data.json</code> Datei herunter. Machen Sie regelmäßige Backups!</li>
                            <li><strong>Reset:</strong> Setzt die App zurück und löscht alle lokal gespeicherten Daten. Achtung, dieser Schritt kann nicht rückgängig gemacht werden.</li>
                        </ul>
                    </section>
                     <section>
                        <h3>Hauptansicht & Filter</h3>
                        <p>Die Hauptansicht zeigt alle Ihre Filament-Spulen als Karten an. Sie können die Ansicht filtern:</p>
                        <ul>
                            <li><strong>Lagerbaum (links):</strong> Klicken Sie auf einen Lagerort, um nur die Spulen anzuzeigen, die sich dort oder in einem Unterordner befinden. "Alle Spulen" zeigt den gesamten Bestand, "Nicht eingelagert" nur die Spulen ohne zugewiesenen Ort.</li>
                            <li><strong>Filterleiste (oben):</strong> Filtern Sie zusätzlich nach Filament-Typ oder Farbe.</li>
                        </ul>
                    </section>
                    <section>
                        <h3>Spulen verwalten</h3>
                        <ul>
                            <li><strong>Neue Spule:</strong> Fügt eine neue, leere Spule zu Ihrer Sammlung hinzu.</li>
                            <li><strong>Gewicht schnell ändern:</strong> Nutzen Sie das Eingabefeld unten auf jeder Spulenkarte, um das Gesamtgewicht schnell nach dem Wiegen zu aktualisieren.</li>
                            <li><strong>Datenblatt:</strong> Klicken Sie auf eine Spulen-Karte, um die Detailansicht zu öffnen. Hier sehen Sie alle erfassten Daten.</li>
                            <li><strong>Bearbeiten, Kopieren, Löschen:</strong> In der Detailansicht können Sie eine Spule bearbeiten, sie als Vorlage für eine neue Spule kopieren oder endgültig löschen.</li>
                            <li><strong>Status "Auf Drucker":</strong> Weisen Sie eine Spule einem Drucker zu, um den Überblick zu behalten, was gerade geladen ist. Der Status wird direkt auf der Spulenkarte angezeigt.</li>
                        </ul>
                    </section>
                    <section>
                        <h3>Lager- & Druckerverwaltung</h3>
                        <p>Organisieren Sie Ihr Lager und Ihre Drucker.</p>
                        <ul>
                            <li>Klicken Sie auf "Lagerverwaltung" oder "Druckerverwaltung" im Header, um die jeweiligen Menüs zu öffnen.</li>
                            <li><strong>Einträge hinzufügen/bearbeiten/löschen:</strong> Verwalten Sie Ihre Lagerorte und Drucker.</li>
                            <li><strong>Etikett drucken (Drucker-Icon):</strong> Drucken Sie für jeden Lagerort ein Etikett mit Name und QR-Code.</li>
                        </ul>
                    </section>
                     <section>
                        <h3>QR-Codes & Scannen</h3>
                        <p>Die App verwendet zwei Arten von QR-Codes für eine schnelle Navigation:</p>
                        <ul>
                            <li><strong>Spulen-Etikett:</strong> Jede Spule hat ein Etikett mit einer eindeutigen ID (z.B. PLA-0001-001).</li>
                            <li><strong>Lagerplatz-Etikett:</strong> Jeder Lagerort hat ein Etikett mit seinem Pfad.</li>
                            <li><strong>Globaler Scan-Button:</strong> Klicken Sie im Header auf "Scannen", um die Kamera zu öffnen. Scannen Sie einen beliebigen Code: Ein Spulen-Code führt Sie direkt zum Datenblatt, ein Lagerort-Code filtert die Hauptansicht.</li>
                        </ul>
                    </section>
                </div>
                <div className="form-actions">
                    <button onClick={onClose} className="button">Schließen</button>
                </div>
            </div>
        </div>
    );
};

const StatisticsView: React.FC<{ filaments: Filament[]; onClose: () => void }> = ({ filaments, onClose }) => {
    const stats = useMemo(() => {
        if (filaments.length === 0) return null;

        let totalValue = 0;
        let totalWeight = 0;
        const valueByType: { [key: string]: number } = {};
        const valueByDiameter: { [key: string]: number } = {};
        const weightByType: { [key: string]: number } = {};

        filaments.forEach(f => {
            const currentWeight = Math.max(0, f.totalWeight - f.spoolWeight);
            totalWeight += currentWeight;
            
            const remainingRatio = f.spoolSize > 0 ? currentWeight / f.spoolSize : 0;
            const currentValue = (f.price || 0) * remainingRatio;
            totalValue += currentValue;
            
            const typeKey = f.type || 'Unbekannt';
            valueByType[typeKey] = (valueByType[typeKey] || 0) + currentValue;
            weightByType[typeKey] = (weightByType[typeKey] || 0) + currentWeight;

            const diameterKey = (f.diameter || 0).toFixed(2);
            valueByDiameter[diameterKey] = (valueByDiameter[diameterKey] || 0) + currentValue;
        });

        return {
            totalSpools: filaments.length,
            totalValue,
            totalWeight,
            valueByType: Object.entries(valueByType).sort((a,b) => b[1] - a[1]),
            weightByType, // No need to sort this one as it's a map for lookup
            valueByDiameter: Object.entries(valueByDiameter).sort((a,b) => b[1] - a[1]),
        };
    }, [filaments]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="statistics-modal-container" onClick={(e) => e.stopPropagation()}>
                <h2>Lager-Statistik</h2>
                <div className="statistics-content">
                    {stats ? (
                        <>
                            <section>
                                <h3>Gesamtübersicht</h3>
                                <div className="stats-list">
                                    <div className="stats-item">
                                        <span className="label">Anzahl Spulen</span>
                                        <span className="value">{stats.totalSpools}</span>
                                    </div>
                                    <div className="stats-item">
                                        <span className="label">Geschätzter Gesamtwert</span>
                                        <span className="value">{stats.totalValue.toFixed(2)} €</span>
                                    </div>
                                    <div className="stats-item">
                                        <span className="label">Gesamtgewicht Filament</span>
                                        <span className="value">
                                            {(stats.totalWeight / 1000).toFixed(2)} kg
                                            <span className="value secondary">({stats.totalWeight.toFixed(0)} g)</span>
                                        </span>
                                    </div>
                                </div>
                            </section>
                            <section>
                                <h3>Nach Materialtyp</h3>
                                <div className="stats-list">
                                    {stats.valueByType.map(([type, value]) => (
                                        <div className="stats-item" key={type}>
                                            <span className="label">{type}</span>
                                            <span className="value">
                                                {value.toFixed(2)} €
                                                <span className="value secondary">({((stats.weightByType[type] || 0) / 1000).toFixed(2)} kg)</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                             <section>
                                <h3>Nach Durchmesser</h3>
                                <div className="stats-list">
                                    {stats.valueByDiameter.map(([diameter, value]) => (
                                        <div className="stats-item" key={diameter}>
                                            <span className="label">{diameter} mm</span>
                                            <span className="value">{value.toFixed(2)} €</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </>
                    ) : (
                        <div className="empty-state-small">Keine Spulen im Bestand, um Statistiken zu erstellen.</div>
                    )}
                </div>
                <div className="form-actions">
                    <button onClick={onClose} className="button">Schließen</button>
                </div>
            </div>
        </div>
    );
};

const ColorCodeListView: React.FC<{ colors: ColorCodeInfo[], onClose: () => void }> = ({ colors, onClose }) => {
    return (
        <div className="color-list-modal-container" onClick={onClose}>
            <div className="color-list-content" onClick={(e) => e.stopPropagation()}>
                <div className="printable-area">
                    <h2 className="no-print">Farb-Code-Liste</h2>
                    {colors.length > 0 ? (
                        <table>
                            <thead>
                                <tr>
                                    <th>Farbe</th>
                                    <th>Hersteller-Farbe</th>
                                    <th>Code (CCC)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {colors.map(c => (
                                    <tr key={c.manufacturerColor}>
                                        <td><div className="color-swatch" style={{ backgroundColor: c.colorHex }}></div></td>
                                        <td>{c.manufacturerColor}</td>
                                        <td>{c.code}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="empty-state-small">Noch keine Farben erfasst. Fügen Sie eine Spule hinzu, um die Liste zu füllen.</p>
                    )}
                </div>
                <div className="form-actions no-print">
                    <button onClick={onClose} className="button button-secondary">Schließen</button>
                    <button onClick={() => window.print()} className="button" disabled={colors.length === 0}>Drucken</button>
                </div>
            </div>
        </div>
    );
};

const WelcomeView: React.FC<{ onCreateNew: () => void; onLoadFile: () => void; }> = ({ onCreateNew, onLoadFile }) => (
    <div className="initial-view-container">
        <h2>Willkommen bei Ihrer Filament-Lagerverwaltung!</h2>
        <p>Ihre Daten werden lokal verwaltet. Beginnen Sie, indem Sie eine neue Liste erstellen oder eine vorhandene Datei laden.</p>
        <div className="initial-actions"><button className="button" onClick={onCreateNew}>Neue Liste erstellen</button><button className="button button-secondary" onClick={onLoadFile}>Daten laden (.json)</button></div>
    </div>
);

const App: React.FC = () => {
    type AppStatus = 'LOADING' | 'FIRST_RUN' | 'READY';
    type AppMode = 'list' | 'detail' | 'add' | 'edit' | 'storage_manager' | 'printer_manager';

    const [appStatus, setAppStatus] = useState<AppStatus>('LOADING');
    const [filaments, setFilamentsInternal] = useState<Filament[]>([]);
    const [storageTree, setStorageTreeInternal] = useState<StorageNode[]>([]);
    const [printers, setPrintersInternal] = useState<Printer[]>([]);
    const [idCounters, setIdCountersInternal] = useState<any>({});
    const [mode, setMode] = useState<AppMode>('list');
    const [currentFilamentId, setCurrentFilamentId] = useState<string | null>(null);
    const [initialDataForForm, setInitialDataForForm] = useState<Partial<Filament> | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [locationFilter, setLocationFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [colorFilter, setColorFilter] = useState('');
    const [printingFilament, setPrintingFilament] = useState<Filament | null>(null);
    const [printingLocation, setPrintingLocation] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [showUserGuide, setShowUserGuide] = useState(false);
    const [showColorCodeList, setShowColorCodeList] = useState(false);
    const [showStatistics, setShowStatistics] = useState(false);


    const fileInputRef = useRef<HTMLInputElement>(null);

    const markUnsaved = () => appStatus === 'READY' && setHasUnsavedChanges(true);
    const setFilaments = (updater: React.SetStateAction<Filament[]>) => { setFilamentsInternal(updater); markUnsaved(); };
    const setStorageTree = (updater: React.SetStateAction<StorageNode[]>) => { setStorageTreeInternal(updater); markUnsaved(); };
    const setPrinters = (updater: React.SetStateAction<Printer[]>) => { setPrintersInternal(updater); markUnsaved(); };
    const setIdCounters = (updater: React.SetStateAction<any>) => { setIdCountersInternal(updater); markUnsaved(); };

    useEffect(() => {
        try {
            const rawData = window.localStorage.getItem('app_data');
            if (rawData === null) setAppStatus('FIRST_RUN');
            else {
                const data = JSON.parse(rawData);
                const { filaments, storageTree, idCounters, printers } = migrateData(data);
                
                setFilamentsInternal(filaments);
                setStorageTreeInternal(storageTree);
                setIdCountersInternal(idCounters);
                setPrintersInternal(printers);
                setAppStatus('READY');
            }
        } catch (e) { console.error(e); setAppStatus('LOADING'); /* Will be caught by main error boundary */ }
    }, []);

    useEffect(() => {
        if (appStatus === 'READY' && hasUnsavedChanges) {
            try {
                window.localStorage.setItem('app_data', JSON.stringify({ filaments, storageTree, idCounters, printers }));
                setHasUnsavedChanges(false);
            } catch (e) { console.error(e); /* Error state needed */ }
        }
    }, [filaments, storageTree, idCounters, printers, appStatus, hasUnsavedChanges]);
    
    useEffect(() => {
        if ((mode === 'detail' || mode === 'edit') && currentFilamentId && !filaments.some(f => f.id === currentFilamentId)) handleGoToOverview();
    }, [filaments, mode, currentFilamentId]);

    const saveFilament = (filamentData: Omit<Filament, 'id'> & { id?: string }) => {
        const isEditing = !!filamentData.id;
        
        const cleanFilamentData = { ...filamentData };
        if (cleanFilamentData.status !== 'Auf Drucker') {
            cleanFilamentData.assignedPrinterId = undefined;
        }

        if (isEditing) {
            const originalFilament = filaments.find(f => f.id === cleanFilamentData.id);
            if (!originalFilament) return;

            const hasCoreChange = originalFilament.type !== cleanFilamentData.type || originalFilament.manufacturerColor !== cleanFilamentData.manufacturerColor;

            if (hasCoreChange) {
                if (!window.confirm("Sie haben Typ oder Herstellerfarbe geändert. Dadurch wird eine neue, eindeutige Spulen-ID generiert und das alte Etikett wird ungültig. Möchten Sie fortfahren?")) {
                    return; // User cancelled
                }
                const { newId, updatedCounters } = generateNewIdAndUpdateCounters(cleanFilamentData.type!, cleanFilamentData.manufacturerColor!, idCounters);
                const updatedFilamentWithNewId: Filament = { ...(cleanFilamentData as Omit<Filament, 'id'>), id: newId };

                setIdCounters(updatedCounters);
                setFilaments(prev => prev.map(f => f.id === originalFilament.id ? updatedFilamentWithNewId : f));
                setCurrentFilamentId(newId);
                setMode('detail');
            } else {
                setFilaments(prev => prev.map(f => {
                    if (cleanFilamentData.status === 'Auf Drucker' && f.assignedPrinterId === cleanFilamentData.assignedPrinterId && f.id !== cleanFilamentData.id) {
                        return { ...f, status: 'Angebrochen', assignedPrinterId: undefined };
                    }
                    if (f.id === cleanFilamentData.id) {
                        return { ...f, ...(cleanFilamentData as Filament) };
                    }
                    return f;
                }));
                setCurrentFilamentId(cleanFilamentData.id!);
                setMode('detail');
            }
        } else {
            const { newId, updatedCounters } = generateNewIdAndUpdateCounters(cleanFilamentData.type!, cleanFilamentData.manufacturerColor!, idCounters);
            const newFilament: Filament = { ...(cleanFilamentData as Omit<Filament, 'id'>), id: newId };
            
            setIdCounters(updatedCounters);
            setFilaments(prev => {
                let updatedList = [...prev];
                if (newFilament.status === 'Auf Drucker' && newFilament.assignedPrinterId) {
                    updatedList = updatedList.map(f => f.assignedPrinterId === newFilament.assignedPrinterId ? { ...f, assignedPrinterId: undefined, status: 'Angebrochen' } : f);
                }
                return [...updatedList, newFilament];
            });
            setCurrentFilamentId(newId);
            setMode('detail');
        }
        setInitialDataForForm(null);
        setIsDirty(true);
    };


    const deleteFilament = (id: string) => {
        if (window.confirm('Sind Sie sicher, dass Sie dieses Spulen-Datenblatt löschen möchten?')) {
            setFilaments(filaments.filter(f => f.id !== id));
            setMode('list');
            setCurrentFilamentId(null);
            setIsDirty(true);
        }
    };

    const handleStartEdit = (id: string) => {
        setInitialDataForForm(filaments.find(f => f.id === id) || null);
        setCurrentFilamentId(id);
        setMode('edit');
    };
    
    const handleUpdateWeight = (id: string, newTotalWeight: number) => {
        setFilaments(prev => prev.map(f => f.id === id ? {...f, totalWeight: newTotalWeight} : f));
        setIsDirty(true);
    };

    const handleCopy = (id: string) => {
        const toCopy = filaments.find(f => f.id === id);
        if (toCopy) {
            const { id: _id, ...copyData } = toCopy;
            setInitialDataForForm(copyData);
            setCurrentFilamentId(null);
            setMode('add');
        }
    };

    const handleStartAdd = () => { setInitialDataForForm(null); setCurrentFilamentId(null); setMode('add'); };
    const handleViewDetail = (id: string) => { setCurrentFilamentId(id); setMode('detail'); };
    const handleGoToOverview = () => { setMode('list'); setCurrentFilamentId(null); };

    const handleCancelForm = () => {
        setMode(mode === 'edit' && currentFilamentId ? 'detail' : 'list');
        setInitialDataForForm(null);
    }
    
    const handleSelectLocation = (path: string) => {
        setLocationFilter(path);
        handleGoToOverview();
    };

    const handleSaveData = async () => {
        if (filaments.length === 0 && storageTree.length === 0) { alert("Es sind keine Daten zum Speichern vorhanden."); return; }
        const jsonString = JSON.stringify({ filaments, storageTree, idCounters, printers }, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({ suggestedName: 'filament_data.json', types: [{ description: 'JSON-Dateien', accept: { 'application/json': ['.json'] } }] });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                alert('Daten erfolgreich gespeichert.');
                setIsDirty(false);
            } catch (error: any) { if (error.name !== 'AbortError') console.error("Fehler beim Speichern der Datei:", error); }
        } else {
            const filename = prompt("Bitte geben Sie einen Dateinamen an:", "filament_data.json");
            if (filename) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert('Daten erfolgreich heruntergeladen.');
                setIsDirty(false);
            }
        }
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) { if(event.target) event.target.value = ''; return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                const { filaments: importedFilaments, storageTree: importedTree } = migrateData(data);
                
                if (window.confirm(`Möchten Sie den aktuellen Bestand durch die importierten Daten (${importedFilaments.length} Spulen, ${importedTree.length} Lagerorte) ERSETZEN?`)) {
                    const { filaments: finalFilaments, storageTree: finalTree, idCounters: finalCounters, printers: finalPrinters } = migrateData(data);
                    setFilamentsInternal(finalFilaments);
                    setStorageTreeInternal(finalTree);
                    setIdCountersInternal(finalCounters);
                    setPrintersInternal(finalPrinters);
                    setHasUnsavedChanges(true); // Mark as unsaved to trigger save to localstorage
                    setAppStatus('READY');
                    handleGoToOverview();
                    alert('Daten erfolgreich geladen.');
                    setIsDirty(false);
                }
            } catch (error) { alert(`Fehler beim Laden der Datei: ${error instanceof Error ? error.message : "Unbekannter Fehler"}`); }
            finally { if(event.target) event.target.value = ''; }
        };
        reader.readAsText(file);
    };

    const handlePrintFilament = (id: string) => {
        setPrintingFilament(filaments.find(f => f.id === id) || null);
    };
    const handlePrintLocation = (path: string) => {
        setPrintingLocation(path);
        setMode('list');
    };
    
    const allLocationPaths = useMemo(() => {
        const paths: string[] = [];
        const traverse = (nodes: StorageNode[]) => nodes.forEach(n => { paths.push(n.path); traverse(n.children); });
        traverse(storageTree);
        return paths.sort();
    }, [storageTree]);

    const allTypes = useMemo(() => [...new Set(filaments.map(f => f.type).filter(Boolean))].sort(), [filaments]);
    const allColors = useMemo(() => [...new Set(filaments.flatMap(f => [f.color, f.manufacturerColor]).filter(Boolean))].sort(), [filaments]);
    
    const colorCodeData = useMemo(() => {
        const colorMap = new Map<string, ColorCodeInfo>();
        if (!idCounters || !idCounters.colorMap) return [];
        
        Object.entries(idCounters.colorMap).forEach(([mfgColor, code]) => {
            if (!colorMap.has(mfgColor)) {
                const filamentWithColor = filaments.find(f => f.manufacturerColor === mfgColor);
                colorMap.set(mfgColor, {
                    manufacturerColor: mfgColor,
                    colorHex: filamentWithColor?.colorHex || '#CCCCCC',
                    code: code as string,
                });
            }
        });
        return Array.from(colorMap.values()).sort((a, b) => a.manufacturerColor.localeCompare(b.manufacturerColor));
    }, [idCounters, filaments]);


    const handleSaveStorageTree = (newTree: StorageNode[]) => {
        const oldPaths: string[] = [];
        const newPaths: string[] = [];
        const traverse = (nodes: StorageNode[], pathList: string[]) => nodes.forEach(n => { pathList.push(n.path); traverse(n.children, pathList); });
        traverse(storageTree, oldPaths);
        traverse(newTree, newPaths);

        const deletedPaths = oldPaths.filter(p => !newPaths.includes(p));
        if (deletedPaths.length > 0) {
            setFilaments(prev => prev.map(f => deletedPaths.includes(f.locationPath) ? { ...f, locationPath: '' } : f));
        }
        
        setStorageTree(newTree);
        setMode('list');
        setIsDirty(true);
    };
    
    const handleSavePrinters = (newPrinters: Printer[]) => {
        const deletedPrinterIds = printers.filter(oldP => !newPrinters.some(newP => newP.id === oldP.id)).map(p => p.id);
        if (deletedPrinterIds.length > 0) {
            setFilaments(prev => prev.map(f => {
                if (f.assignedPrinterId && deletedPrinterIds.includes(f.assignedPrinterId)) {
                    return { ...f, status: 'Angebrochen', assignedPrinterId: undefined };
                }
                return f;
            }));
        }
        setPrinters(newPrinters);
        setMode('list');
        setIsDirty(true);
    };

    const handleGlobalScan = (scannedText: string) => {
        setIsScanning(false);
        const parts = scannedText.split('::');
        if (parts.length < 2) {
            alert(`Unbekanntes QR-Code Format: ${scannedText}`);
            return;
        }

        const type = parts[0];
        const data = parts.slice(1).join('::'); // Rejoin in case data contains '::'

        if (type === 'FMT_SPOOL') {
            if (filaments.some(f => f.id === data)) {
                handleViewDetail(data);
            } else {
                alert("Spule nicht gefunden.");
            }
        } else if (type === 'FMT_LOCATION') {
            if (allLocationPaths.includes(data) || data === "") {
                setLocationFilter(data);
                handleGoToOverview();
            } else {
                alert("Lagerort nicht gefunden.");
            }
        } else {
            alert(`Unbekanntes QR-Code Format: ${scannedText}`);
        }
    };
    
    const filteredFilaments = useMemo(() => {
        return filaments
            .filter(f => {
                if (!locationFilter) return true;
                if (locationFilter === '__UNSORTED__') return !f.locationPath;
                return f.locationPath && f.locationPath.startsWith(locationFilter);
            })
            .filter(f => !typeFilter || f.type.toLowerCase().includes(typeFilter.toLowerCase()))
            .filter(f => !colorFilter || 
                (f.manufacturerColor && f.manufacturerColor.toLowerCase().includes(colorFilter.toLowerCase())) || 
                (f.color && f.color.toLowerCase().includes(colorFilter.toLowerCase()))
            );
    }, [filaments, locationFilter, typeFilter, colorFilter]);

    const currentFilamentForView = useMemo(() => (mode === 'detail') ? filaments.find(f => f.id === currentFilamentId) || null : null, [filaments, mode, currentFilamentId]);

    const handleReset = () => {
        if(window.confirm("Möchten Sie die App wirklich zurücksetzen? Alle nicht gespeicherten Daten gehen verloren.")) {
            window.localStorage.removeItem('app_data');
            setFilamentsInternal([]);
            setStorageTreeInternal([]);
            setIdCountersInternal({});
            setPrintersInternal([]);
            setHasUnsavedChanges(false);
            setMode('list');
            setCurrentFilamentId(null);
            setAppStatus('FIRST_RUN');
            setIsDirty(false);
        }
    }

    const handleCreateNew = () => {
        if(isDirty && !window.confirm("Sie haben ungespeicherte Änderungen. Möchten Sie trotzdem eine neue, leere Liste erstellen?")) return;
        setFilamentsInternal([]);
        setStorageTreeInternal([]);
        setIdCountersInternal({});
        setPrintersInternal([]);
        setHasUnsavedChanges(true); // Mark as unsaved to trigger save of empty state
        setMode('list');
        setCurrentFilamentId(null);
        setAppStatus('READY');
        setIsDirty(false);
    }
    
    if (appStatus === 'LOADING') return null;
    if (appStatus === 'FIRST_RUN') return <main><WelcomeView onCreateNew={handleCreateNew} onLoadFile={() => fileInputRef.current?.click()} /><input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".json,application/json" /></main>;
    
    return (
        <>
            <main>
                <header>
                    <h1>FMT <span className="header-subtitle">Filament Management Tool by <a href="https://www.myopenbusiness.de" target="_blank" rel="noopener noreferrer">myOpenBusiness</a></span></h1>
                    <div className="header-actions">
                        <button className="button button-icon" onClick={() => setShowColorCodeList(true)} title="Farb-Code-Liste anzeigen">
                             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.34 0 .67-.02 1-.05M7.32 18.7c.84-.58 1.58-1.25 2.2-2M15 2.46A8.92 8.92 0 0 1 21.54 9c.74 2.5.21 5.25-1.54 7.25-.87 1-1.87 1.8-3 2.45M18.7 7.32c-.58-.84-1.25-1.58-2-2.2M9 21.54A8.92 8.92 0 0 1 2.46 15c-2.5-.74-5.25-.21-7.25 1.54-1 .87-1.8 1.87-2.45 3"/></svg>
                        </button>
                        <button className="button button-icon" onClick={() => setShowStatistics(true)} title="Lager-Statistik anzeigen">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>
                        </button>
                         <button className="button button-icon" onClick={() => setShowUserGuide(true)} title="Bedienungsanleitung anzeigen">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        </button>
                        <div className="separator"></div>
                        {mode === 'list' && <button className="button button-secondary" onClick={() => setMode('printer_manager')}>Druckerverwaltung</button>}
                        {mode === 'list' && <button className="button button-secondary" onClick={() => setMode('storage_manager')}>Lagerverwaltung</button>}
                        <button className="button" onClick={() => setIsScanning(true)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg> Scannen</button>
                        <button className="button button-secondary" onClick={() => fileInputRef.current?.click()}>Laden</button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".json,application/json"/>
                        <button className={`button button-secondary ${isDirty ? 'has-unsaved-changes' : ''}`} onClick={handleSaveData}>Speichern</button>
                        {mode === 'list' ? <button className="button" onClick={handleStartAdd}>Neue Spule</button> : <button className="button" onClick={handleGoToOverview}>Zurück zur Übersicht</button>}
                        <button className="button button-danger button-small" onClick={handleReset} title="App Zurücksetzen">Reset</button>
                    </div>
                </header>
                
                <div className={`app-layout ${mode !== 'list' ? 'full-width-content' : ''}`} key={`${mode}-${currentFilamentId}`}>
                     {mode === 'list' && <StorageTreeView tree={storageTree} selected={locationFilter} onSelect={setLocationFilter} />}

                    <div className="content-area">
                        {mode === 'list' && (
                            <>
                                <div className="filter-bar">
                                    <div className="filter-group">
                                        <label htmlFor="typeFilter">Typ</label>
                                        <input id="typeFilter" list="type-datalist" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} placeholder="Nach Typ filtern..." />
                                        <datalist id="type-datalist">
                                            {allTypes.map(t => <option key={t} value={t} />)}
                                        </datalist>
                                    </div>
                                    <div className="filter-group">
                                        <label htmlFor="colorFilter">Farbe</label>
                                        <input id="colorFilter" list="color-datalist" value={colorFilter} onChange={e => setColorFilter(e.target.value)} placeholder="Nach Farbe filtern..." />
                                        <datalist id="color-datalist">
                                            {allColors.map(c => <option key={c} value={c} />)}
                                        </datalist>
                                    </div>
                                    <button className="button button-secondary button-small" onClick={() => { setTypeFilter(''); setColorFilter(''); }} disabled={!typeFilter && !colorFilter}>
                                        Zurücksetzen
                                    </button>
                                </div>
                                <FilamentMatrixView filaments={filteredFilaments} printers={printers} totalCount={filaments.length} onViewDetail={handleViewDetail} onUpdateWeight={handleUpdateWeight} />
                            </>
                        )}
                         {mode === 'detail' && currentFilamentForView && <FilamentDetailView filament={currentFilamentForView} printers={printers} onDelete={deleteFilament} onEdit={handleStartEdit} onCopy={handleCopy} onPrint={handlePrintFilament} onSelectLocation={handleSelectLocation} />}
                         {(mode === 'add' || mode === 'edit') && <FilamentForm onSave={saveFilament} onCancel={handleCancelForm} initialData={initialDataForForm} isEditing={mode === 'edit'} storageLocations={allLocationPaths} printers={printers} filaments={filaments} />}
                    </div>
                </div>
            </main>
            {printingFilament && <div className="print-modal-wrapper"><PrintLabelView filament={printingFilament} onClose={() => setPrintingFilament(null)} /></div>}
            {printingLocation && <div className="print-modal-wrapper"><LocationLabelPreview locationPath={printingLocation} onClose={() => setPrintingLocation(null)} /></div>}
            {isScanning && <BarcodeScanner onScan={handleGlobalScan} onClose={() => setIsScanning(false)} />}
            {mode === 'storage_manager' && <StorageManager initialTree={storageTree} onSave={handleSaveStorageTree} onClose={() => setMode('list')} onPrint={handlePrintLocation} />}
            {mode === 'printer_manager' && <PrinterManager initialPrinters={printers} onSave={handleSavePrinters} onClose={() => setMode('list')} />}
            {showUserGuide && <UserGuide onClose={() => setShowUserGuide(false)} />}
            {showStatistics && <StatisticsView filaments={filaments} onClose={() => setShowStatistics(false)} />}
            {showColorCodeList && <div className="print-modal-wrapper"><ColorCodeListView colors={colorCodeData} onClose={() => setShowColorCodeList(false)} /></div>}
        </>
    );
};

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}