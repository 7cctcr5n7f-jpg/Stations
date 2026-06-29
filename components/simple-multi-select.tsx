"use client"

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Check, ChevronDown, X, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SimpleMultiSelectProps {
  options: string[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  specialOptions?: { value: string; label: string }[];
  onClose?: () => void;
  onNewItemAdded?: (newItem: string) => void;
}

export function SimpleMultiSelect({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = "Select options...",
  className,
  specialOptions = [],
  onClose,
  onNewItemAdded
}: SimpleMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newItemInput, setNewItemInput] = useState('');
  const [showNewItemField, setShowNewItemField] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Memoize combined options for performance with search filtering
  const allOptions = useMemo(() => {
    const combined = [
      ...specialOptions.map(opt => ({ value: opt.value, label: opt.label, isSpecial: true })),
      ...options.map(opt => ({ value: opt, label: opt, isSpecial: false }))
    ];
    
    if (!searchQuery) return combined;
    
    return combined.filter(opt => 
      opt.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [options, specialOptions, searchQuery]);

  const toggleOption = (value: string) => {
    const newSelected = selectedValues.includes(value)
      ? selectedValues.filter(v => v !== value)
      : [...selectedValues, value];
    onSelectionChange(newSelected);
  };

  const addNewItem = () => {
    const trimmedInput = newItemInput.trim();
    if (trimmedInput && !selectedValues.includes(trimmedInput)) {
      const newSelected = [...selectedValues, trimmedInput];
      onSelectionChange(newSelected);
      onNewItemAdded?.(trimmedInput); // Notify parent about new item
      setNewItemInput('');
      setShowNewItemField(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewItem();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < allOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : allOptions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < allOptions.length) {
          toggleOption(allOptions[highlightedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
        onClose?.();
        break;
    }
  };

  const removeOption = (value: string) => {
    onSelectionChange(selectedValues.filter(v => v !== value));
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  // Calculate dropdown position when opening
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const dropdownHeight = 240; // max-h-60 = 240px
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Use top positioning if there's not enough space below but enough above
      if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
      }
    }
  }, [isOpen]);

  // Reset highlighted index when options change due to search
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [allOptions.length]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setHighlightedIndex(-1);
          }
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex items-center justify-between w-full h-7 px-3 py-1 text-xs bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500",
          className
        )}
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
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {/* Selected Items Display */}
      {selectedValues.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {selectedValues.map((value) => (
            <span
              key={value}
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded max-w-[120px]"
            >
              <span className="truncate">{value}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeOption(value);
                }}
                className="ml-1 text-blue-600 hover:text-blue-800 flex-shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setIsOpen(false);
              setSearchQuery('');
              setHighlightedIndex(-1);
              onClose?.();
            }}
          />
          
          {/* Dropdown Content */}
          <div className={cn(
            "absolute left-0 right-0 z-20 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto min-w-max",
            dropdownPosition === 'bottom' ? "top-full mt-1" : "bottom-full mb-1"
          )}>
            {/* Search Input */}
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search options..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setHighlightedIndex(-1); // Reset highlight when searching
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-7 pr-7 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                {searchQuery && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery('');
                    }}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Clear All */}
            {selectedValues.length > 0 && (
              <div className="px-3 py-2 border-b border-gray-100">
                <button
                  onClick={clearAll}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Clear All ({selectedValues.length})
                </button>
              </div>
            )}

            {/* Options */}
            {allOptions.map((option, index) => {
              const isSelected = selectedValues.includes(option.value);
              const isHighlighted = index === highlightedIndex;
              return (
                <div
                  key={option.value}
                  onClick={() => {
                    toggleOption(option.value);
                    // Immediate visual feedback
                  }}
                  className={cn(
                    "flex items-center px-3 py-2 text-xs cursor-pointer whitespace-nowrap transition-colors duration-75",
                    isSelected && "bg-blue-50",
                    isHighlighted && "bg-gray-100",
                    !isSelected && !isHighlighted && "hover:bg-gray-50"
                  )}
                >
                  <div className="flex items-center justify-center w-4 h-4 mr-3 border border-gray-300 rounded flex-shrink-0">
                    {isSelected && (
                      <Check className="w-3 h-3 text-blue-600" />
                    )}
                  </div>
                  <span className={cn(
                    option.isSpecial && "text-gray-600 italic"
                  )}>
                    {option.label}
                  </span>
                </div>
              );
            })}

            {/* Add Custom Entry */}
            <div className="border-t border-gray-100">
              {!showNewItemField ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewItemField(true);
                  }}
                  className="flex items-center w-full px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Plus className="w-3 h-3 mr-2" />
                  Add custom entry
                </button>
              ) : (
                <div className="px-3 py-2 space-y-2">
                  <input
                    type="text"
                    value={newItemInput}
                    onChange={(e) => setNewItemInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type new entry..."
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                  <div className="flex space-x-2">
                    <button
                      onClick={addNewItem}
                      disabled={!newItemInput.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowNewItemField(false);
                        setNewItemInput('');
                      }}
                      className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {allOptions.length === 0 && !showNewItemField && (
              <div className="px-3 py-2 text-xs text-gray-500">
                {searchQuery ? "No matching options found" : "No options available - use \"Add custom entry\" above"}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}