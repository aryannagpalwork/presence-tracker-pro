import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MapPin, Radio, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user, isAdmin } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="container mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold">
          <MapPin className="h-5 w-5 text-primary" />
          GeoTrack
        </div>
        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link to="/tracker"><Button variant="ghost" size="sm">Tracker</Button></Link>
              {isAdmin && <Link to="/admin"><Button variant="ghost" size="sm">Admin</Button></Link>}
            </>
          ) : (
            <Link to="/login"><Button size="sm">Sign in</Button></Link>
          )}
        </nav>
      </header>

      <main className="container mx-auto px-6 py-20 text-center">
        <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight">
          Real-time location tracking, built for teams.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Share your GPS location every 10 seconds. Admins see everyone live on a Google Map —
          updates stream over websockets the moment they arrive.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to={user ? "/tracker" : "/login"}>
            <Button size="lg">{user ? "Open tracker" : "Get started"}</Button>
          </Link>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-6 md:grid-cols-3">
          <Feature icon={<MapPin className="h-5 w-5" />} title="GPS tracking" desc="Browser geolocation, manual start/stop, 10s ping interval." />
          <Feature icon={<Radio className="h-5 w-5" />} title="Live updates" desc="Realtime websockets — admins see new pings instantly." />
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="Role-based access" desc="Admin & user roles with row-level security." />
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-left">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
