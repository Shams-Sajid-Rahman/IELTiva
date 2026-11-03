export type HealthData = {
  application: string;
  apiVersion: string;
  environment: string;
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  timestamp: string;
};
