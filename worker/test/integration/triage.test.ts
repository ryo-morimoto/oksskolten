import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb, seedFeed, seedArticle } from "../helpers";
import { computeFeedInterests, getRecommendedArticles } from "../../src/lib/triage";

describe("Triage", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  describe("computeFeedInterests", () => {
    it("returns higher interest for feeds with more engagement", async () => {
      const highFeed = (await seedFeed({ name: "High Engagement", url: "https://high.com" })) as {
        id: number;
      };
      const lowFeed = (await seedFeed({ name: "Low Engagement", url: "https://low.com" })) as {
        id: number;
      };

      // High engagement feed: articles are read and liked
      const a1 = (await seedArticle(highFeed.id)) as { id: number };
      await env.DB.prepare(
        "UPDATE articles SET read_at = datetime('now'), liked_at = datetime('now') WHERE id = ?",
      )
        .bind(a1.id)
        .run();
      const a2 = (await seedArticle(highFeed.id)) as { id: number };
      await env.DB.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?")
        .bind(a2.id)
        .run();

      // Low engagement feed: articles untouched
      await seedArticle(lowFeed.id);
      await seedArticle(lowFeed.id);

      const interests = await computeFeedInterests(env.DB);
      const highInterest = interests.find((f) => f.feedId === highFeed.id)!;
      const lowInterest = interests.find((f) => f.feedId === lowFeed.id)!;

      expect(highInterest.interest).toBeGreaterThan(lowInterest.interest);
      expect(lowInterest.interest).toBeGreaterThanOrEqual(0.1); // floor
    });
  });

  describe("getRecommendedArticles", () => {
    it("ranks high-quality articles from engaged feeds first", async () => {
      const feed = (await seedFeed()) as { id: number };

      // Article A: high quality, engaged feed
      const a = (await seedArticle(feed.id, { title: "Deep Technical Guide" })) as { id: number };
      await env.DB.prepare("UPDATE articles SET quality_score = 0.9 WHERE id = ?").bind(a.id).run();
      await env.DB.prepare(
        "UPDATE articles SET read_at = datetime('now'), liked_at = datetime('now') WHERE id = ?",
      )
        .bind(a.id)
        .run();

      // Article B: low quality
      const b = (await seedArticle(feed.id, { title: "Short Update" })) as { id: number };
      await env.DB.prepare("UPDATE articles SET quality_score = 0.1 WHERE id = ?").bind(b.id).run();

      const result = await getRecommendedArticles(env.DB, {
        unread_only: false,
        limit: 10,
        offset: 0,
      });
      expect(result.articles[0]!.title).toBe("Deep Technical Guide");
      expect(result.articles[0]!.recommendation_score).toBeGreaterThan(
        result.articles[1]!.recommendation_score,
      );
    });

    it("filters by unread_only (default)", async () => {
      const feed = (await seedFeed()) as { id: number };
      await seedArticle(feed.id, { title: "Unread" });
      const b = (await seedArticle(feed.id, { title: "Read" })) as { id: number };
      await env.DB.prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?")
        .bind(b.id)
        .run();

      const result = await getRecommendedArticles(env.DB, { limit: 100, offset: 0 });
      expect(result.articles.every((a) => a.title === "Unread")).toBe(true);
    });

    it("filters by min_quality", async () => {
      const feed = (await seedFeed()) as { id: number };
      (await seedArticle(feed.id, { title: "Good" })) as { id: number };
      (await seedArticle(feed.id, { title: "Bad" })) as { id: number };

      // Set quality scores
      const articles = await env.DB.prepare("SELECT id, title FROM articles ORDER BY id").all<{
        id: number;
        title: string;
      }>();
      for (const art of articles.results) {
        const score = art.title === "Good" ? 0.8 : 0.2;
        await env.DB.prepare("UPDATE articles SET quality_score = ? WHERE id = ?")
          .bind(score, art.id)
          .run();
      }

      const result = await getRecommendedArticles(env.DB, {
        min_quality: 0.5,
        unread_only: false,
        limit: 100,
        offset: 0,
      });
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]!.title).toBe("Good");
    });

    it("defaults quality_score to 0.3 for unscored articles", async () => {
      const feed = (await seedFeed()) as { id: number };
      await seedArticle(feed.id, { title: "No Score" });

      const result = await getRecommendedArticles(env.DB, {
        unread_only: false,
        limit: 100,
        offset: 0,
      });
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]!.recommendation_score).toBeGreaterThan(0);
    });

    it("ranks scored articles above unscored in cold-start (zero engagement)", async () => {
      const feed = (await seedFeed()) as { id: number };
      // Scored article: quality 0.7
      const scored = (await seedArticle(feed.id, { title: "Scored" })) as { id: number };
      await env.DB.prepare("UPDATE articles SET quality_score = 0.7 WHERE id = ?")
        .bind(scored.id)
        .run();
      // Unscored article: quality NULL → defaults to 0.3
      await seedArticle(feed.id, { title: "Unscored" });

      const result = await getRecommendedArticles(env.DB, {
        unread_only: false,
        limit: 10,
        offset: 0,
      });
      expect(result.articles[0]!.title).toBe("Scored");
      expect(result.articles[0]!.recommendation_score).toBeGreaterThan(
        result.articles[1]!.recommendation_score,
      );
    });

    it("supports pagination", async () => {
      const feed = (await seedFeed()) as { id: number };
      for (let i = 0; i < 5; i++) {
        await seedArticle(feed.id, { title: `Article ${i}` });
      }

      const page1 = await getRecommendedArticles(env.DB, {
        limit: 2,
        offset: 0,
        unread_only: false,
      });
      const page2 = await getRecommendedArticles(env.DB, {
        limit: 2,
        offset: 2,
        unread_only: false,
      });
      expect(page1.articles).toHaveLength(2);
      expect(page2.articles).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.articles[0]!.id).not.toBe(page2.articles[0]!.id);
    });
  });
});
