"use client";

import { BookOpen, CheckCircle2, ChevronRight, Headphones, Inbox, PenLine, Sparkles, Timer, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BandScore } from "@/components/feedback/band-score";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatCard } from "@/components/feedback/stat-card";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { HoverLift, Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const colors = [
  ["Midnight Navy", "bg-brand-navy"],
  ["Royal Blue", "bg-brand-blue"],
  ["Soft Blue", "bg-brand-sky"],
  ["Success Green", "bg-brand-green"],
  ["Primary action", "bg-primary"],
  ["Accent", "bg-accent"],
  ["Muted", "bg-muted"],
  ["Success", "bg-success"],
  ["Warning", "bg-warning"],
  ["Info", "bg-info"],
  ["Destructive", "bg-destructive"],
  ["Card", "bg-card"],
] as const;

const modules = [
  { icon: Headphones, title: "Listening", text: "Timed practice with audio played once." },
  { icon: BookOpen, title: "Reading", text: "Passages with every question type." },
  { icon: PenLine, title: "Writing", text: "Detailed feedback on each criterion." },
];

export function DesignSystemShowcase() {
  const [replay, setReplay] = useState(0);

  return (
    <>
      <div className="border-b">
        <Container className="py-12 sm:py-16">
          <Badge variant="secondary">Internal reference, sample data only</Badge>
          <h1 className="mt-4 text-4xl font-medium sm:text-5xl">IELTiva design system</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl text-lg">
            Brand tokens and reusable components for every later page, in light and dark themes.
          </p>
        </Container>
      </div>

      <Section id="foundations" title="Colour and type" description="Components use semantic tokens, so both themes stay consistent.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {colors.map(([name, swatch]) => (
            <div key={name} className="overflow-hidden rounded-lg border">
              <div className={`h-16 ${swatch}`} />
              <p className="p-2 text-sm font-medium">{name}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-3">
          <p className="font-display text-4xl font-medium sm:text-5xl">Display heading</p>
          <p className="font-display text-2xl font-medium">Section heading</p>
          <p className="max-w-2xl leading-relaxed">Body text is set in Inter for comfortable reading during long practice sessions.</p>
          <p className="text-muted-foreground text-sm">Supporting text for hints and descriptions.</p>
        </div>
      </Section>

      <Section id="actions" title="Actions" className="bg-muted/40">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button size="lg">
            Large <ChevronRight aria-hidden />
          </Button>
          <Button size="sm">Small</Button>
          <Button variant="outline" onClick={() => toast.success("Your answers were saved")}>
            Show toast
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </Section>

      <Section id="forms" title="Forms" description="Every control has a visible label and a clear keyboard focus state.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ds-email">Email</Label>
              <Input id="ds-email" type="email" placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-invalid">Password</Label>
              <Input id="ds-invalid" type="password" aria-invalid aria-describedby="ds-invalid-msg" defaultValue="short" />
              <p id="ds-invalid-msg" className="text-destructive text-sm">Use at least 10 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-module">Test module</Label>
              <Select>
                <SelectTrigger id="ds-module" className="w-full">
                  <SelectValue placeholder="Choose a module" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="academic">Academic</SelectItem>
                  <SelectItem value="general">General Training</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-notes">Your answer</Label>
              <Textarea id="ds-notes" rows={3} placeholder="Start writing" />
            </div>
          </div>
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Checkbox id="ds-terms" />
              <Label htmlFor="ds-terms">I accept the terms</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="ds-reminders" />
              <Label htmlFor="ds-reminders">Study reminders</Label>
            </div>
            <fieldset>
              <legend className="mb-3 text-sm font-medium">True, False or Not Given</legend>
              <RadioGroup defaultValue="true">
                {["True", "False", "Not Given"].map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option.toLowerCase()} id={`ds-${option.replace(" ", "-")}`} />
                    <Label htmlFor={`ds-${option.replace(" ", "-")}`}>{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
        </div>
      </Section>

      <Section id="cards" title="Cards and data" className="bg-muted/40">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Practice time" value="12h 40m" hint="Sample value" icon={<Timer aria-hidden />} />
          <StatCard label="Reading accuracy" value="78%" hint="Sample value" icon={<BookOpen aria-hidden />} />
          <StatCard label="Essays reviewed" value="6" hint="Sample value" icon={<PenLine aria-hidden />} />
        </div>
        <Card className="shadow-soft mt-4">
          <CardHeader>
            <CardTitle className="font-display text-xl font-medium">Writing Task 2 progress</CardTitle>
            <CardDescription>Progress indicator with an accessible name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={62} aria-label="Writing progress" />
            <div className="flex items-center gap-3">
              <Avatar><AvatarFallback>SS</AvatarFallback></Avatar>
              <span className="text-sm">Sample student</span>
            </div>
          </CardContent>
          <CardFooter><Button variant="outline">Continue</Button></CardFooter>
        </Card>
      </Section>

      <Section id="band" title="Band score states" description="Unvalidated scores never reach students. The hidden state can't accept a score at all.">
        <div className="grid gap-4 md:grid-cols-3">
          <div><p className="mb-2 text-sm font-medium">Hidden, the default</p><BandScore visibility="HIDDEN" /></div>
          <div><p className="mb-2 text-sm font-medium">Internal, staff only</p><BandScore visibility="INTERNAL" band={6.5} /></div>
          <div><p className="mb-2 text-sm font-medium">Public, after validation</p><BandScore visibility="PUBLIC" band={6.5} /></div>
        </div>
      </Section>

      <Section id="feedback" title="Feedback" className="bg-muted/40">
        <div className="grid gap-4 md:grid-cols-2">
          <Alert>
            <CheckCircle2 aria-hidden />
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>Your answers are saved automatically.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>Connection lost</AlertTitle>
            <AlertDescription>We&apos;ll retry when you&apos;re back online.</AlertDescription>
          </Alert>
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <Card><EmptyState icon={<Inbox aria-hidden />} title="No attempts yet" description="Your completed practice appears here." /></Card>
        </div>
      </Section>

      <Section id="overlays" title="Navigation and overlays" description="All are keyboard operable, and focus returns after closing.">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit your attempt?</DialogTitle>
                <DialogDescription>You can&apos;t change your answers after submitting.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Keep working</Button></DialogClose>
                <DialogClose asChild><Button>Submit</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="outline">Hover or focus</Button></TooltipTrigger>
            <TooltipContent>Helpful short hint</TooltipContent>
          </Tooltip>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Tabs defaultValue="listening">
            <TabsList>
              <TabsTrigger value="listening">Listening</TabsTrigger>
              <TabsTrigger value="reading">Reading</TabsTrigger>
            </TabsList>
            <TabsContent value="listening" className="text-muted-foreground p-2 text-sm">Four parts and 40 questions.</TabsContent>
            <TabsContent value="reading" className="text-muted-foreground p-2 text-sm">Three sections and 40 questions.</TabsContent>
          </Tabs>
          <Accordion type="single" collapsible>
            <AccordionItem value="one">
              <AccordionTrigger className="font-sans">How is feedback produced?</AccordionTrigger>
              <AccordionContent>AI reviews your writing against each criterion.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="two">
              <AccordionTrigger className="font-sans">Are these official scores?</AccordionTrigger>
              <AccordionContent>No. IELTiva never provides official IELTS results.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Section>

      <Section id="motion" title="Motion" description="Motion stays short and purposeful, and is reduced when your device asks for it." className="bg-muted/40">
        <Button variant="outline" className="mb-5" onClick={() => setReplay((n) => n + 1)}>
          <Sparkles aria-hidden /> Replay
        </Button>
        <Stagger key={replay} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(({ icon: Icon, title, text }) => (
            <StaggerItem key={title}>
              <HoverLift>
                <Card className="shadow-soft h-full">
                  <CardHeader>
                    <Icon className="text-primary size-6" aria-hidden />
                    <CardTitle role="heading" aria-level={3} className="font-display mt-2 text-xl font-medium">{title}</CardTitle>
                    <CardDescription>{text}</CardDescription>
                  </CardHeader>
                </Card>
              </HoverLift>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal className="text-muted-foreground mt-4 text-sm">Cards lift on hover, and content fades in on scroll.</Reveal>
      </Section>
    </>
  );
}
