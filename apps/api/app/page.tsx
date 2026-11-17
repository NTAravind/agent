import Link from "next/link";
import { ArrowRight, Cpu, Layers, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="min-h-screen bg-muted/20 flex flex-col justify-center items-center p-6 sm:p-12">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Zap className="size-6" />
          </div>
          <Badge variant="outline" className="text-xs font-semibold tracking-wider uppercase">
            Agent Control Room
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Model &amp; Agent Gateway
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Manage provider model availability, secure server credentials, and real-time usage telemetry.
          </p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Web Dashboard</CardTitle>
            <CardDescription className="text-xs">
              Access the administrative control center to configure models for the Expo mobile app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              <span>Multi-provider catalog sync (Google Gemini, Groq, OpenRouter)</span>
            </div>
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              <span>Granular toggle for mobile exposure and capabilities routing</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <span>Zero-secret client architecture &amp; Supabase OAuth authentication</span>
            </div>
          </CardContent>
          <CardFooter className="pt-2">
            <Link href="/dashboard" className="w-full">
              <Button className="w-full gap-2 cursor-pointer shadow-xs">
                <span>Enter Provider Dashboard</span>
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
