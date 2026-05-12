import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const showAdmin = isAdmin || import.meta.env.DEV;

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <MapPin className="h-5 w-5 text-primary" /> GeoTrack
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/tracker">
              <Button variant="ghost" size="sm">
                Tracker
              </Button>
            </Link>
            {showAdmin && (
              <Link to="/admin">
                <Button variant="ghost" size="sm">
                  Admin Panel
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut().then(() => navigate({ to: "/" }))}
            >
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
