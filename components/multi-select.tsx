"use client"

import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  options: string[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  specialOptions?: { value: string; label: string }[];
}

export function MultiSelect({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = "Select options...",
  className,
  specialOptions = []
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleOption = (value: string) => {
    console.log('MultiSelect: toggling option', value, 'current selections:', selectedValues);
    const newSelected = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    console.log('MultiSelect: new selections:', newSelected);
    onSelectionChange(newSelected);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        className={cn("h-7 text-xs justify-between w-full", className)}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">
          {selectedValues.length === 0 ? (
            <span className="text-gray-500">{placeholder}</span>
          ) : selectedValues.length === 1 ? (
            selectedValues[0]
          ) : (
            `${selectedValues.length} selected`
          )}
        </span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>
      
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-[1000] mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {/* Clear All Button */}
          {selectedValues.length > 0 && (
            <div className="p-2 border-b">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                className="text-xs text-red-600 hover:text-red-700"
              >
                Clear All
              </button>
            </div>
          )}
          
          {/* Special Options */}
          {specialOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 cursor-pointer hover:bg-gray-50 text-xs",
                selectedValues.includes(option.value) && "bg-blue-50"
              )}
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={() => toggleOption(option.value)}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded"
              />
              <span className="text-gray-600 italic">{option.label}</span>
            </label>
          ))}
          
          {/* Regular Options */}
          {options.map((option) => (
            <label
              key={option}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 cursor-pointer hover:bg-gray-50 text-xs",
                selectedValues.includes(option) && "bg-blue-50"
              )}
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(option)}
                onChange={() => toggleOption(option)}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function MultiSelectDisplay({ 
  selectedValues, 
  onRemove, 
  className 
}: { 
  selectedValues: string[]; 
  onRemove: (value: string) => void;
  className?: string;
}) {
  if (selectedValues.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1 mt-1", className)}>
      {selectedValues.map((value) => (
        <Badge
          key={value}
          variant="secondary"
          className="text-xs h-5 px-2 bg-blue-100 text-blue-800 hover:bg-blue-200"
        >
          {value}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(value);
            }}
            className="ml-1 hover:text-blue-900"
          >
            <X className="h-2 w-2" />
          </button>
        </Badge>
      ))}
    </div>
  );
}