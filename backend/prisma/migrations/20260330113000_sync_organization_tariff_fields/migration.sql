UPDATE "organizations"
SET "tariff_per_package_kopecks" = GREATEST(0, ROUND("user_tarif" * 100)::BIGINT)
WHERE "user_tarif" IS NOT NULL
  AND GREATEST(0, ROUND("user_tarif" * 100)::BIGINT) <> "tariff_per_package_kopecks";

CREATE OR REPLACE FUNCTION "sync_organization_tariff_fields"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."tariff_per_package_kopecks" IS NOT NULL AND NEW."tariff_per_package_kopecks" > 0 THEN
      NEW."user_tarif" := NEW."tariff_per_package_kopecks"::DOUBLE PRECISION / 100.0;
    ELSIF NEW."user_tarif" IS NOT NULL AND NEW."user_tarif" > 0 THEN
      NEW."tariff_per_package_kopecks" := GREATEST(0, ROUND(NEW."user_tarif" * 100)::BIGINT);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."tariff_per_package_kopecks" IS DISTINCT FROM OLD."tariff_per_package_kopecks" THEN
    IF NEW."tariff_per_package_kopecks" IS NULL OR NEW."tariff_per_package_kopecks" <= 0 THEN
      NEW."user_tarif" := NULL;
    ELSE
      NEW."user_tarif" := NEW."tariff_per_package_kopecks"::DOUBLE PRECISION / 100.0;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."user_tarif" IS DISTINCT FROM OLD."user_tarif" THEN
    IF NEW."user_tarif" IS NOT NULL THEN
      NEW."tariff_per_package_kopecks" := GREATEST(0, ROUND(NEW."user_tarif" * 100)::BIGINT);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_sync_organization_tariff_fields" ON "organizations";

CREATE TRIGGER "trg_sync_organization_tariff_fields"
BEFORE INSERT OR UPDATE OF "user_tarif", "tariff_per_package_kopecks"
ON "organizations"
FOR EACH ROW
EXECUTE FUNCTION "sync_organization_tariff_fields"();

