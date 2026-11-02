CREATE TABLE `preview_alert_deliveries` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`created` integer NOT NULL,
	`record` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `preview_deliveries_by_time` ON `preview_alert_deliveries` (`owner`,`created`);