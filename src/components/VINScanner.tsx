'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Quagga from '@ericblade/quagga2';
import { createWorker } from 'tesseract.js';
import { isValidVIN, extractVIN } from '@/lib/vin-validation';

interface VINScannerProps {
  onVINDetected?: (vin: string) => void;
}

export default function VINScanner({ onVINDetected }: VINScannerProps) {
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<string>('');
  const [resultType, setResultType] = useState<'success' | 'error' | 'info'>('info');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [fps, setFps] = useState(0);
  const [resolution, setResolution] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [successfulDecodes, setSuccessfulDecodes] = useState(0);
  const [lastBarcodeText, setLastBarcodeText] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const attemptsRef = useRef(0);
  const successRef = useRef(0);
  const lastBarcodeRef = useRef('');
  const isQuaggaInitRef = useRef(false);

  const appendDebug = useCallback((message: string) => {
    const timestamp = new Date().toISOString().split('T')[1]?.replace('Z', '') ?? '';
    setDebugInfo((prev) => {
      const next = [`[${timestamp}] ${message}`, ...prev];
      return next.slice(0, 200);
    });
    // Also mirror to console for dev tools visibility
    // eslint-disable-next-line no-console
    console.debug('[VINScanner]', message);
  }, []);


  const stopCamera = useCallback(() => {
    if (isQuaggaInitRef.current) {
      try {
        Quagga.stop();
        isQuaggaInitRef.current = false;
      } catch (e) {
        console.error('Error stopping Quagga:', e);
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsScanning(false);
    setTorchOn(false);
  }, []);

  const showResult = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setResult(text);
    setResultType(type);
  }, []);

  const startBarcodeScanning = async () => {
    if (isScanning) return;

    setIsScanning(true);
    showResult('Starting camera and barcode scanner...', 'info');
    appendDebug('Starting camera request');

    try {
      // Reset counters
      attemptsRef.current = 0;
      successRef.current = 0;
      lastBarcodeRef.current = '';

      // Initialize Quagga
      await new Promise<void>((resolve, reject) => {
        Quagga.init(
          {
            inputStream: {
              type: 'LiveStream',
              target: videoContainerRef.current!,
              constraints: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
            },
            decoder: {
              readers: [
                'code_39_reader',
                'code_39_vin_reader',
                'code_93_reader',
                'code_128_reader',
              ],
              debug: {
                drawBoundingBox: true,
                showFrequency: true,
                drawScanline: true,
                showPattern: true,
              },
            },
            locate: true,
            locator: {
              patchSize: 'large',
              halfSample: false,
            },
            frequency: 10,
          },
          (err) => {
            if (err) {
              console.error('Quagga init error:', err);
              reject(err);
              return;
            }

            // Get the video element that Quagga created
            const video = videoContainerRef.current?.querySelector('video');
            if (video) {
              video.addEventListener('loadedmetadata', () => {
                const w = video.videoWidth ?? 0;
                const h = video.videoHeight ?? 0;
                if (w && h) setResolution({ w, h });
              });

              // Get stream for torch support
              if (video.srcObject && video.srcObject instanceof MediaStream) {
                streamRef.current = video.srcObject;
                const [track] = video.srcObject.getVideoTracks();
                const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
                if (capabilities?.torch) {
                  setTorchSupported(true);
                }
                const settings = track.getSettings?.();
                if (settings?.width && settings?.height) {
                  setResolution({ w: settings.width as number, h: settings.height as number });
                }
              }
            }

            // Set up detection handler BEFORE starting
            Quagga.onDetected((result) => {
              successRef.current += 1;
              appendDebug('Barcode detected!');

              if (result.codeResult && result.codeResult.code) {
                const text = result.codeResult.code.trim();
                console.log('Barcode detected:', text);
                appendDebug(`Raw barcode: ${text}`);

                const candidate = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                lastBarcodeRef.current = candidate;

                // Try to extract valid VIN
                const extractedVIN = extractVIN(candidate);

                if (extractedVIN) {
                  appendDebug(`VIN detected: ${extractedVIN}`);
                  stopCamera();
                  showResult(`VIN detected: ${extractedVIN}`, 'success');
                  onVINDetected?.(extractedVIN);
                  return;
                }

                // Show raw barcode for debugging
                if (candidate.length >= 10) {
                  showResult(`Scanned: ${candidate.slice(0, 30)}... (checking validity...)`, 'info');
                  appendDebug(`Invalid VIN candidate: ${candidate.slice(0, 30)}`);
                }
              }
            });

            // Set up processed handler for tracking attempts
            Quagga.onProcessed((result) => {
              attemptsRef.current += 1;

              if (attemptsRef.current <= 5) {
                appendDebug(`Frame ${attemptsRef.current} processed`);
              }
            });

            Quagga.start();
            isQuaggaInitRef.current = true;
            appendDebug('Quagga started successfully');
            resolve();
          }
        );
      });

      showResult('Camera active - scanning for VIN barcodes...', 'info');
      appendDebug('Camera active; scanning started with Quagga');
    } catch (error) {
      console.error('Camera error:', error);
      showResult(`Camera error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      appendDebug(`Camera error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      stopCamera();
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;

    const [track] = streamRef.current.getVideoTracks();
    const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };

    if (capabilities?.torch) {
      try {
        const newTorchState = !torchOn;
        await track.applyConstraints({
          // @ts-expect-error - torch is not in standard TS types
          advanced: [{ torch: newTorchState }],
        });
        setTorchOn(newTorchState);
        appendDebug(`Torch toggled: ${newTorchState ? 'ON' : 'OFF'}`);
      } catch (error) {
        console.error('Torch error:', error);
        showResult('Failed to toggle torch', 'error');
        appendDebug(`Torch error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const captureForOCR = async (file: File) => {
    setIsProcessing(true);
    showResult('Running OCR on image...', 'info');
    appendDebug('OCR started');

    try {
      const img = await createImageBitmap(file);
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Preprocess: convert to grayscale and increase contrast
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const processed = gray > 128 ? 255 : 0; // Simple threshold
        data[i] = data[i + 1] = data[i + 2] = processed;
      }

      ctx.putImageData(imageData, 0, 0);

      // Run OCR
      const worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(canvas);
      await worker.terminate();

      // Try to extract VIN
      const extractedVIN = extractVIN(text);

      if (extractedVIN) {
        showResult(`VIN (OCR): ${extractedVIN}`, 'success');
        onVINDetected?.(extractedVIN);
        appendDebug(`OCR VIN detected: ${extractedVIN}`);
      } else {
        const candidate = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        showResult(`OCR result: ${candidate.slice(0, 50)}... (no valid VIN found)`, 'error');
        appendDebug('OCR finished, no valid VIN found');
      }
    } catch (error) {
      console.error('OCR error:', error);
      showResult(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      appendDebug(`OCR error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      captureForOCR(file);
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Update UI counters periodically
  useEffect(() => {
    if (!isScanning) return;

    const interval = setInterval(() => {
      setScanAttempts(attemptsRef.current);
      setSuccessfulDecodes(successRef.current);
      setLastBarcodeText(lastBarcodeRef.current);
    }, 500);

    return () => clearInterval(interval);
  }, [isScanning]);


  const resultColor = {
    success: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  }[resultType];

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">VIN Scanner</h2>

      {/* Video preview with overlay - Compact view */}
      <div className="relative inline-block w-full mb-4">
        <div
          ref={videoContainerRef}
          id="interactive"
          className="viewport w-full max-w-full border-2 border-gray-300 rounded-lg bg-black overflow-hidden"
          style={{ maxHeight: '300px', position: 'relative' }}
        />
        {/* Frame overlay */}
        {isScanning && (
          <div
            className="absolute border-2 border-dashed border-green-400 pointer-events-none"
            style={{
              width: '80%',
              height: '60px',
              left: '10%',
              top: 'calc(50% - 30px)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
            }}
          />
        )}
      </div>

      {/* Status bar */}
      {isScanning && (
        <div className="mb-3 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs flex flex-wrap gap-3">
          <span>Res: {resolution.w}x{resolution.h}</span>
          <span>Attempts: {scanAttempts}</span>
          <span>Detections: {successfulDecodes}</span>
          <span>Torch: {torchOn ? 'ON' : 'OFF'}</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={isScanning ? stopCamera : startBarcodeScanning}
          disabled={isProcessing}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isScanning ? 'Stop Camera' : 'Start Barcode Scan'}
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Capture Image (OCR)'}
        </button>

        {torchSupported && isScanning && (
          <button
            onClick={toggleTorch}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
          >
            Torch: {torchOn ? 'ON' : 'OFF'}
          </button>
        )}

        <button
          onClick={() => setDebugMode((d) => !d)}
          className={`px-4 py-2 rounded-lg text-white ${debugMode ? 'bg-purple-700 hover:bg-purple-800' : 'bg-purple-600 hover:bg-purple-700'}`}
        >
          Debug: {debugMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Hidden canvas for OCR preprocessing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Result display */}
      {result && (
        <div className={`mt-4 p-4 rounded-lg border-2 ${resultColor} bg-opacity-10`}>
          <p className={`font-semibold ${resultColor}`}>{result}</p>
        </div>
      )}

      {/* Debug logs */}
      {debugMode && (
        <div className="mt-4 border-2 border-purple-500 rounded-lg p-3 bg-purple-50 dark:bg-purple-950">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-base text-purple-900 dark:text-purple-100">Debug Logs</h3>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(debugInfo.join('\n'))}
                className="px-3 py-1 text-xs rounded bg-purple-200 hover:bg-purple-300 dark:bg-purple-800 dark:hover:bg-purple-700"
              >
                Copy
              </button>
              <button
                onClick={() => setDebugInfo([])}
                className="px-3 py-1 text-xs rounded bg-purple-200 hover:bg-purple-300 dark:bg-purple-800 dark:hover:bg-purple-700"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="text-xs h-64 overflow-auto rounded border-2 border-purple-300 dark:border-purple-700 p-3 bg-white dark:bg-gray-900 font-mono">
            {debugInfo.length === 0 ? (
              <div className="text-gray-500">Waiting for debug logs...</div>
            ) : (
              <ul className="space-y-1">
                {debugInfo.map((msg, idx) => (
                  <li key={idx} className="whitespace-pre-wrap break-all">{msg}</li>
                ))}
              </ul>
            )}
          </div>
          {lastBarcodeText && (
            <div className="mt-2 text-xs p-2 bg-yellow-100 dark:bg-yellow-900 rounded">
              <span className="font-semibold">Last scanned:</span> {lastBarcodeText.slice(0, 80)}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 text-sm text-gray-600 dark:text-gray-400">
        <h3 className="font-semibold mb-2">Tips:</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>Use barcode scan for labels and paperwork (faster & more accurate)</li>
          <li>Use image capture (OCR) for stamped VINs on metal surfaces</li>
          <li>Position the VIN within the highlighted frame</li>
          <li>Ensure good lighting or use torch for better results</li>
          <li>VINs are exactly 17 characters (no I, O, or Q letters)</li>
        </ul>
      </div>
    </div>
  );
}
