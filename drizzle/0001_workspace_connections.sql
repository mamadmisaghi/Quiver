CREATE TABLE `preview_connections` (
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`label` text NOT NULL,
	`hint` text NOT NULL,
	`sealed` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`used` text,
	PRIMARY KEY(`owner`, `kind`)
);
