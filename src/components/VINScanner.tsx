'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { createWorker } from 'tesseract.js';
import { isValidVIN, extractVIN } from '@/lib/vin-validation';

interface VINScannerProps {
  onVINDetected?: (vin: string) => void;
}

export default function VINScanner({ onVINDetected }: VINScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<string>('');
  const [resultType, setResultType] = useState<'success' | 'error' | 'info'>('info');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [scanAttempts, setScanAttempts] = useState(0);

  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset();
      } catch (e) {
        console.error('Error resetting code reader:', e);
      }
      codeReaderRef.current = null;
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

    try {
      // First get camera stream with proper constraints
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Connect stream to video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Check torch capabilities
      const [track] = stream.getVideoTracks();
      const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      if (capabilities?.torch) {
        setTorchSupported(true);
      }

      // Initialize barcode reader
      const codeReader = new BrowserMultiFormatReader();
      codeReaderRef.current = codeReader;

      // Start continuous decoding with hints for better VIN detection
      const hints = new Map();
      const formats = [
        // Common VIN barcode formats
        1, // Code 39
        2, // Code 93
        3, // Code 128
        12, // PDF417
        14, // DataMatrix
      ];
      hints.set(2, formats); // DecodeHintType.POSSIBLE_FORMATS

      await codeReader.decodeFromVideoDevice(
        undefined, // let it use current stream
        videoRef.current!,
        (result, error) => {
          if (result) {
            const text = result.getText().trim();
            console.log('Barcode detected:', text);

            const candidate = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

            // Try to extract valid VIN
            const extractedVIN = extractVIN(candidate);

            if (extractedVIN) {
              stopCamera();
              showResult(`VIN detected: ${extractedVIN}`, 'success');
              onVINDetected?.(extractedVIN);
              return;
            }

            // Show raw barcode for debugging
            if (candidate.length >= 10) {
              showResult(`Scanned: ${candidate.slice(0, 30)}... (checking validity...)`, 'info');
            }
          }

          if (error && !(error instanceof NotFoundException)) {
            console.error('Barcode scan error:', error);
          }
        }
      );

      showResult('Camera active - scanning for VIN barcodes...', 'info');
    } catch (error) {
      console.error('Camera error:', error);
      showResult(`Camera error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
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
      } catch (error) {
        console.error('Torch error:', error);
        showResult('Failed to toggle torch', 'error');
      }
    }
  };

  const captureForOCR = async (file: File) => {
    setIsProcessing(true);
    showResult('Running OCR on image...', 'info');

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
      } else {
        const candidate = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        showResult(`OCR result: ${candidate.slice(0, 50)}... (no valid VIN found)`, 'error');
      }
    } catch (error) {
      console.error('OCR error:', error);
      showResult(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
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

  const resultColor = {
    success: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  }[resultType];

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">VIN Scanner</h2>

      {/* Video preview with overlay */}
      <div className="relative inline-block w-full mb-4">
        <video
          ref={videoRef}
          className="w-full max-w-full border-2 border-gray-300 rounded-lg bg-black"
          playsInline
          autoPlay
          muted
        />
        {/* Frame overlay */}
        {isScanning && (
          <div
            className="absolute border-2 border-dashed border-white pointer-events-none"
            style={{
              width: '80%',
              height: '80px',
              left: '10%',
              top: 'calc(50% - 40px)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
            }}
          />
        )}
      </div>

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
