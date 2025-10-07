'use client';

import { useState } from 'react';
import VINScanner from '@/components/VINScanner';

export default function Home() {
  const [scannedVINs, setScannedVINs] = useState<string[]>([]);

  const handleVINDetected = (vin: string) => {
    setScannedVINs((prev) => [vin, ...prev]);
  };

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">
          Vehicle VIN Scanner
        </h1>

        <VINScanner onVINDetected={handleVINDetected} />

        {/* Scanned VINs History */}
        {scannedVINs.length > 0 && (
          <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Scanned VINs</h3>
            <ul className="space-y-2">
              {scannedVINs.map((vin, index) => (
                <li
                  key={`${vin}-${index}`}
                  className="p-3 bg-white dark:bg-gray-700 rounded font-mono text-lg"
                >
                  {vin}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setScannedVINs([])}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Clear History
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
