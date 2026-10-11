import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// TODO: пока есть только /healthz, CORS остаётся открытым. До появления реальных
// роутов задайте CORS_ORIGINS (список origin через запятую), чтобы включить whitelist.
const corsOrigins = process.env["CORS_ORIGINS"];
app.use(
  corsOrigins
    ? cors({
        origin: corsOrigins
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      })
    : cors(),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// JSON 404 для неопознанных /api/* маршрутов (вместо дефолтной HTML-страницы Express)
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Централизованный обработчик ошибок Express
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
