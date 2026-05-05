import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setMapsKey } from "@/lib/maps-key";

export function MapsKeyPrompt({ onSaved }: { onSaved: () => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Google Maps API key required</CardTitle>
          <CardDescription>
            Paste your Google Maps JavaScript API key (publishable, referrer-restricted) to enable the map.
            Get one at <a className="underline" target="_blank" rel="noreferrer" href="https://console.cloud.google.com/google/maps-apis/credentials">Google Cloud Console</a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="AIza…" value={val} onChange={(e) => setVal(e.target.value)} />
          <Button className="w-full" disabled={!val.trim()} onClick={() => { setMapsKey(val); onSaved(); }}>
            Save & load map
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
