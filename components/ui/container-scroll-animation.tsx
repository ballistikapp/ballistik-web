"use client";
import React, { useRef } from "react";
import { useScroll, useTransform, motion, MotionValue } from "motion/react";

export const ContainerScroll = ({
  titleComponent,
  children,
  cardAnimationDelay = 0,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
  cardAnimationDelay?: number;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const scaleDimensions = () => {
    return isMobile ? [1, 1] : [1, 1.05];
  };

  const rotateRange = isMobile ? [2, 0] : [10, 0];
  const translateRange = isMobile ? [0, -120] : [0, -500];

  const rotate = useTransform(scrollYProgress, [0, 0.1], rotateRange);
  const scale = useTransform(scrollYProgress, [0, 0.5], scaleDimensions());
  const translate = useTransform(scrollYProgress, [0, 0.5], translateRange);

  return (
    <div
      className="w-full sm:w-[90%] md:w-[75%] mx-auto flex items-start justify-center relative px-0 sm:px-4 md:px-10 pt-4 md:pt-8"
      ref={containerRef}
    >
      <div
        className="w-full relative"
        style={{
          perspective: "2000px",
        }}
      >
        <Header translate={translate} titleComponent={titleComponent} />
        <div className="h-12" />
        <Card
          rotate={rotate}
          translate={translate}
          scale={scale}
          animationDelay={cardAnimationDelay}
        >
          {children}
        </Card>
      </div>
    </div>
  );
};

export const Header = ({ translate, titleComponent }: any) => {
  return (
    <motion.div
      style={{
        translateY: translate,
      }}
      className="div max-w-5xl mx-auto text-center"
    >
      {titleComponent}
    </motion.div>
  );
};

export const Card = ({
  rotate,
  scale,
  children,
  animationDelay = 0,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  translate: MotionValue<number>;
  children: React.ReactNode;
  animationDelay?: number;
}) => {
  return (
    <motion.div
      style={{
        rotateX: rotate,
        scale,
        boxShadow:
          "0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003",
      }}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut", delay: animationDelay }}
      className="mt-10 md:mt-12 mx-auto w-full border-4 border-[#464646] p-1 md:p-2 bg-[#222222] rounded-xl shadow-2xl"
    >
      <div className="w-full overflow-hidden rounded-xl bg-zinc-900">
        {children}
      </div>
    </motion.div>
  );
};
