"use client";

import { motion, type HTMLMotionProps, type Variants } from "motion/react";

const ease = [0.22, 1, 0.36, 1] as const;

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

/** Fades content in as it enters the viewport. MotionConfig removes the movement for reduced-motion users. */
export function Reveal(props: HTMLMotionProps<"div">) {
  return <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }} variants={itemVariants} {...props} />;
}

export function Stagger(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
      {...props}
    />
  );
}

export function StaggerItem(props: HTMLMotionProps<"div">) {
  return <motion.div variants={itemVariants} {...props} />;
}

/** Subtle lift for interactive cards. */
export function HoverLift(props: HTMLMotionProps<"div">) {
  return <motion.div whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={{ duration: 0.2, ease }} {...props} />;
}
